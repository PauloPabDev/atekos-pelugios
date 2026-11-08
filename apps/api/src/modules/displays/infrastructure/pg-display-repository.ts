import { and, asc, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { apiTokens, displays, displayTemplates } from '../../../db/schema'
import { Conflict, NotFound, Unprocessable } from '../../../shared/errors'
import type { DisplayRecord, DisplayRepository } from '../domain/ports'

type Row = typeof displays.$inferSelect

const toRecord = (r: Row): DisplayRecord => ({
	...r,
	createdAt: r.createdAt.toISOString(),
	updatedAt: r.updatedAt.toISOString(),
})

// Primera fila de un UPDATE … RETURNING. Sin fila, la pantalla se borró entre la lectura y la escritura.
async function one(q: Promise<Row[]>) {
	const [row] = await q
	if (!row) throw NotFound('Pantalla')
	return toRecord(row)
}

const now = sql`clock_timestamp()`
const templateKey = (displayId: string, templateId: string) =>
	and(eq(displayTemplates.displayId, displayId), eq(displayTemplates.templateId, templateId))

// Bloquea la fila de la pantalla hasta el fin de la transacción: así setActive, deleteTemplate y delete se serializan
// (sin él, una activación concurrente con el borrado de esa plantilla podría dejar activa una plantilla inexistente).
async function lockDisplay(tx: Pick<NodePgDatabase, 'select'>, id: string) {
	const [d] = await tx
		.select({ active: displays.activeTemplateId })
		.from(displays)
		.where(eq(displays.id, id))
		.for('update')
	if (!d) throw NotFound('Pantalla')
	return d.active
}

export const makePgDisplayRepository = (db: NodePgDatabase): DisplayRepository => ({
	create(d, template) {
		return db.transaction(async (tx) => {
			const [row] = await tx
				.insert(displays)
				.values({ ...d, activeTemplateId: template.id })
				.onConflictDoNothing({ target: displays.hardwareId })
				.returning()
			if (!row) return null
			await tx
				.insert(displayTemplates)
				.values({ displayId: row.id, templateId: template.id, version: template.version, body: template })
			return toRecord(row)
		})
	},
	async findById(id) {
		const [row] = await db.select().from(displays).where(eq(displays.id, id))
		return row ? toRecord(row) : null
	},
	async findByHardwareId(hardwareId) {
		const [row] = await db.select().from(displays).where(eq(displays.hardwareId, hardwareId))
		return row ? toRecord(row) : null
	},
	async listByOwner(ownerId) {
		const rows = await db.select().from(displays).where(eq(displays.ownerId, ownerId)).orderBy(asc(displays.createdAt))
		return rows.map(toRecord)
	},
	async findTemplate(displayId, templateId) {
		const [row] = await db
			.select({ body: displayTemplates.body })
			.from(displayTemplates)
			.where(templateKey(displayId, templateId))
		return row?.body ?? null
	},
	async listTemplates(displayId) {
		const rows = await db
			.select({ body: displayTemplates.body })
			.from(displayTemplates)
			.where(eq(displayTemplates.displayId, displayId))
			.orderBy(asc(displayTemplates.templateId))
		return rows.map((r) => r.body)
	},
	async upsertTemplate(displayId, t) {
		const rows = await db
			.insert(displayTemplates)
			.values({ displayId, templateId: t.id, version: t.version, body: t })
			.onConflictDoUpdate({
				target: [displayTemplates.displayId, displayTemplates.templateId],
				set: { version: t.version, body: t, updatedAt: now },
				// Atómico: si no devuelve fila es que ya había una versión igual o mayor.
				setWhere: sql`${displayTemplates.version} < excluded.version`,
			})
			.returning({ id: displayTemplates.templateId })
		if (!rows.length)
			throw Conflict(`La plantilla ${t.id} ya existe con una versión igual o mayor`, 'version_not_incremented')
	},
	deleteTemplate(displayId, templateId) {
		return db.transaction(async (tx) => {
			if ((await lockDisplay(tx, displayId)) === templateId) throw Conflict('No se puede borrar la plantilla activa')
			const rows = await tx
				.delete(displayTemplates)
				.where(templateKey(displayId, templateId))
				.returning({ id: displayTemplates.templateId })
			if (!rows.length) throw NotFound('Plantilla')
		})
	},
	setActive(displayId, templateId) {
		return db.transaction(async (tx) => {
			await lockDisplay(tx, displayId)
			// Tras el bloqueo esta lectura ya ve un borrado concurrente de la plantilla (READ COMMITTED).
			const [t] = await tx
				.select({ body: displayTemplates.body })
				.from(displayTemplates)
				.where(templateKey(displayId, templateId))
			if (!t) throw Unprocessable('template_not_found', `No existe la plantilla ${templateId}`)
			const display = await one(
				tx
					.update(displays)
					.set({ activeTemplateId: templateId, updatedAt: now })
					.where(eq(displays.id, displayId))
					.returning(),
			)
			return { display, template: t.body }
		})
	},
	rename(id, name) {
		return one(db.update(displays).set({ name, updatedAt: now }).where(eq(displays.id, id)).returning())
	},
	replaceValues(id, values) {
		return one(db.update(displays).set({ values, updatedAt: now }).where(eq(displays.id, id)).returning())
	},
	async mergeValues(id, patch) {
		const merged = sql`${displays.values} || ${JSON.stringify(patch)}::jsonb`
		// El límite va en el WHERE: con escrituras concurrentes PG lo vuelve a evaluar sobre la última versión de la fila.
		const [row] = await db
			.update(displays)
			.set({ values: merged, updatedAt: now })
			.where(and(eq(displays.id, id), sql`(select count(*) from jsonb_object_keys(${merged})) <= 64`))
			.returning()
		// Sin fila: el merge pasaría de 64 claves (o la pantalla se borró justo ahora; el caso de uso ya comprobó que existía).
		if (!row) throw Unprocessable('invalid_data', 'máximo 64 variables')
		return toRecord(row)
	},
	delete(id) {
		return db.transaction(async (tx) => {
			// Con la fila bloqueada no se puede crear otro token ligado entre la lectura y el borrado.
			await lockDisplay(tx, id)
			const tokens = await tx.select({ hash: apiTokens.tokenHash }).from(apiTokens).where(eq(apiTokens.displayId, id))
			await tx.delete(displays).where(eq(displays.id, id))
			return tokens.map((t) => t.hash)
		})
	},
})

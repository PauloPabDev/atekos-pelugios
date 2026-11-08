import {
	pgTable,
	pgEnum,
	uuid,
	text,
	boolean,
	integer,
	jsonb,
	timestamp,
	uniqueIndex,
	primaryKey,
} from 'drizzle-orm/pg-core'
import type { DisplayTemplate, DisplayValues } from '@atekos/shared'

export const visibility = pgEnum('visibility', ['public', 'private'])
export const deviceType = pgEnum('device_type', ['light', 'switch', 'sensor', 'generic'])
export const deviceStatus = pgEnum('device_status', ['active', 'inactive'])

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const users = pgTable('users', {
	id: uuid('id').primaryKey().defaultRandom(),
	email: text('email').notNull().unique(), // se guarda en minúsculas
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(), // argon2id
	createdAt: createdAt(),
})

export const devices = pgTable(
	'devices',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		ownerId: uuid('owner_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		slug: text('slug').notNull(), // "cuarto", único por dueño
		name: text('name').notNull(),
		description: text('description').notNull().default(''),
		type: deviceType('type').notNull().default('generic'),
		state: boolean('state').notNull().default(false),
		data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
		visibility: visibility('visibility').notNull().default('private'),
		status: deviceStatus('status').notNull().default('active'),
		createdAt: createdAt(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [uniqueIndex('devices_owner_slug').on(t.ownerId, t.slug)],
)

// MetaDisplay (docs/metadisplay/DISENO.md §2)
export const displays = pgTable('displays', {
	id: uuid('id').primaryKey().defaultRandom(),
	ownerId: uuid('owner_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	hardwareId: text('hardware_id').notNull().unique(), // 'md-34B7DA01ABCD', normalizado por DisplayHardwareId
	name: text('name').notNull(),
	activeTemplateId: text('active_template_id').notNull(),
	values: jsonb('values').$type<DisplayValues>().notNull().default({}),
	createdAt: createdAt(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const displayTemplates = pgTable(
	'display_templates',
	{
		displayId: uuid('display_id')
			.notNull()
			.references(() => displays.id, { onDelete: 'cascade' }),
		templateId: text('template_id').notNull(),
		version: integer('version').notNull(),
		body: jsonb('body').$type<DisplayTemplate>().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.displayId, t.templateId] })],
)

export const apiTokens = pgTable('api_tokens', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'cascade' }), // null = todos mis dispositivos
	displayId: uuid('display_id').references(() => displays.id, { onDelete: 'cascade' }), // token ligado a una pantalla
	name: text('name').notNull(), // "ESP cuarto"
	prefix: text('prefix').notNull(), // "dmt_AbC12": para reconocerlo en la UI
	tokenHash: text('token_hash').notNull().unique(), // HMAC-SHA256; el token en claro nunca se guarda
	scopes: text('scopes').array().notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }),
	lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
	revokedAt: timestamp('revoked_at', { withTimezone: true }),
	createdAt: createdAt(),
})

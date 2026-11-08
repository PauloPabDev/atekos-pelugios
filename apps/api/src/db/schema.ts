import { pgTable, pgEnum, uuid, text, boolean, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

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

export const apiTokens = pgTable('api_tokens', {
	id: uuid('id').primaryKey().defaultRandom(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'cascade' }), // null = todos mis dispositivos
	name: text('name').notNull(), // "ESP cuarto"
	prefix: text('prefix').notNull(), // "dmt_AbC12": para reconocerlo en la UI
	tokenHash: text('token_hash').notNull().unique(), // HMAC-SHA256; el token en claro nunca se guarda
	scopes: text('scopes').array().notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }),
	lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
	revokedAt: timestamp('revoked_at', { withTimezone: true }),
	createdAt: createdAt(),
})

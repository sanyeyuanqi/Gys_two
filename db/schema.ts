import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// D1 keeps only server-side upstream sessions. All business records remain in
// the original GYS service and are fetched by the backend when requested.
export const upstreamSessions = sqliteTable('upstream_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  upstreamUserId: integer('upstream_user_id'),
  username: text('username'),
  displayName: text('display_name'),
  role: text('role'),
  cookies: text('cookies').notNull(),
  authenticated: integer('authenticated').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (table) => [
  index('idx_upstream_sessions_expires_at').on(table.expiresAt),
  index('idx_upstream_sessions_user_id').on(table.upstreamUserId),
]);

export const upstreamRateLimits = sqliteTable('upstream_rate_limits', {
  name: text('name').primaryKey(),
  count: integer('count').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (table) => [index('idx_upstream_rate_limits_expires_at').on(table.expiresAt)]);

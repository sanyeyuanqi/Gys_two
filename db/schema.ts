import { index, integer, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('sub'),
  parentId: integer('parent_id').references((): AnySQLiteColumn => users.id),
  status: integer('status').notNull().default(1),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_users_username').on(table.username),
  index('idx_users_parent_status').on(table.parentId, table.status),
]);

export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  index('idx_sessions_user_id').on(table.userId),
  index('idx_sessions_expires_at').on(table.expiresAt),
]);

export const channels = sqliteTable('channels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ownerId: integer('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  uploaderId: integer('uploader_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: text('category').notNull(),
  tag: text('tag').notNull(),
  keyHash: text('key_hash').notNull(),
  keyMasked: text('key_masked').notNull(),
  status: integer('status').notNull().default(1),
  usedQuota: integer('used_quota').notNull().default(0),
  quota: integer('quota').notNull().default(10000000),
  successRate: real('success_rate').notNull().default(100),
  reqError: integer('req_error').notNull().default(0),
  models: text('models').notNull().default(''),
  remark: text('remark').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [
  uniqueIndex('idx_channels_owner_key').on(table.ownerId, table.keyHash),
  index('idx_channels_owner_status').on(table.ownerId, table.status),
  index('idx_channels_owner_category').on(table.ownerId, table.category),
  index('idx_channels_owner_tag').on(table.ownerId, table.tag),
  index('idx_channels_uploader_id').on(table.uploaderId),
]);

export const apiKeys = sqliteTable('api_keys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  tokenHash: text('token_hash').notNull(),
  scopes: text('scopes').notNull(),
  status: integer('status').notNull().default(1),
  lastUsedAt: text('last_used_at'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('idx_api_keys_token_hash').on(table.tokenHash),
  index('idx_api_keys_user_status').on(table.userId, table.status),
]);

export const disableKeywords = sqliteTable('disable_keywords', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  keyword: text('keyword').notNull(),
  status: integer('status').notNull().default(1),
  createdAt: text('created_at').notNull(),
}, (table) => [uniqueIndex('idx_disable_keywords_user_keyword').on(table.userId, table.keyword)]);

export const auditLogs = sqliteTable('audit_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  detail: text('detail').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [index('idx_audit_logs_user_created').on(table.userId, table.createdAt)]);

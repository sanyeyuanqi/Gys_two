CREATE TABLE `api_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`token_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`status` integer DEFAULT 1 NOT NULL,
	`last_used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_api_keys_token_hash` ON `api_keys` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_user_status` ON `api_keys` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`action` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_user_created` ON `audit_logs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`uploader_id` integer NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`tag` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_masked` text NOT NULL,
	`status` integer DEFAULT 1 NOT NULL,
	`used_quota` integer DEFAULT 0 NOT NULL,
	`quota` integer DEFAULT 10000000 NOT NULL,
	`success_rate` real DEFAULT 100 NOT NULL,
	`req_error` integer DEFAULT 0 NOT NULL,
	`models` text DEFAULT '' NOT NULL,
	`remark` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_channels_owner_key` ON `channels` (`owner_id`,`key_hash`);--> statement-breakpoint
CREATE INDEX `idx_channels_owner_status` ON `channels` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_channels_owner_category` ON `channels` (`owner_id`,`category`);--> statement-breakpoint
CREATE INDEX `idx_channels_owner_tag` ON `channels` (`owner_id`,`tag`);--> statement-breakpoint
CREATE INDEX `idx_channels_uploader_id` ON `channels` (`uploader_id`);--> statement-breakpoint
CREATE TABLE `disable_keywords` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`keyword` text NOT NULL,
	`status` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_disable_keywords_user_keyword` ON `disable_keywords` (`user_id`,`keyword`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user_id` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires_at` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'sub' NOT NULL,
	`parent_id` integer,
	`status` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_username` ON `users` (`username`);--> statement-breakpoint
CREATE INDEX `idx_users_parent_status` ON `users` (`parent_id`,`status`);--> statement-breakpoint
PRAGMA optimize;

CREATE TABLE `upstream_rate_limits` (
	`name` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_upstream_rate_limits_expires_at` ON `upstream_rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `upstream_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`upstream_user_id` integer,
	`username` text,
	`display_name` text,
	`role` text,
	`cookies` text NOT NULL,
	`authenticated` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_upstream_sessions_expires_at` ON `upstream_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_upstream_sessions_user_id` ON `upstream_sessions` (`upstream_user_id`);
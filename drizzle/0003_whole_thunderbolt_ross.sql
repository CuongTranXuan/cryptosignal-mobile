CREATE TABLE `dashboard_credentials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`username` varchar(64) NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dashboard_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `dashboard_credentials_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
CREATE TABLE `dashboard_sessions` (
	`id` varchar(64) NOT NULL,
	`credentialId` int NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dashboard_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `dashboard_sessions_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE INDEX `dashboard_credentials_username_idx` ON `dashboard_credentials` (`username`);--> statement-breakpoint
CREATE INDEX `dashboard_sessions_credential_idx` ON `dashboard_sessions` (`credentialId`);--> statement-breakpoint
CREATE INDEX `dashboard_sessions_expiry_idx` ON `dashboard_sessions` (`expiresAt`);
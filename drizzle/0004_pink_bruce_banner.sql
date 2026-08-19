CREATE TABLE `runner_health` (
	`id` int NOT NULL,
	`runId` varchar(64),
	`state` varchar(24) NOT NULL,
	`configVersion` int,
	`startedAt` timestamp,
	`finishedAt` timestamp,
	`cycleCount` int NOT NULL DEFAULT 0,
	`failureCount` int NOT NULL DEFAULT 0,
	`lastError` text,
	`summaryJson` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `runner_health_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `runner_health_updated_idx` ON `runner_health` (`updatedAt`);
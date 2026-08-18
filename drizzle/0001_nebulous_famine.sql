CREATE TABLE `audit_events` (
	`id` varchar(64) NOT NULL,
	`action` varchar(80) NOT NULL,
	`actorType` varchar(32) NOT NULL,
	`actorId` varchar(80) NOT NULL,
	`payloadJson` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bot_configs` (
	`id` int NOT NULL,
	`configVersion` int NOT NULL,
	`isPaused` boolean NOT NULL DEFAULT false,
	`watchlistJson` text NOT NULL,
	`timeframesJson` text NOT NULL,
	`ruleFamiliesJson` text NOT NULL,
	`alertThreshold` double NOT NULL,
	`cooldownMinutes` int NOT NULL,
	`quietHoursJson` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bot_configs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `signal_snapshots` (
	`id` varchar(64) NOT NULL,
	`assetSymbol` varchar(32) NOT NULL,
	`venue` varchar(64) NOT NULL,
	`timeframe` varchar(12) NOT NULL,
	`candleCloseTime` timestamp NOT NULL,
	`state` varchar(32) NOT NULL,
	`score` double NOT NULL,
	`confidence` double NOT NULL,
	`regime` varchar(32) NOT NULL,
	`dataQualityState` varchar(32) NOT NULL,
	`findingsJson` text NOT NULL,
	`conflictsJson` text NOT NULL,
	`invalidationJson` text NOT NULL,
	`strategyVersion` varchar(32) NOT NULL,
	`configVersion` int NOT NULL,
	`sourceManifestId` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `signal_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `telegram_polling_state` (
	`id` int NOT NULL,
	`updateOffset` int NOT NULL DEFAULT 0,
	`lastPolledAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `telegram_polling_state_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `audit_events_created_idx` ON `audit_events` (`createdAt`);--> statement-breakpoint
CREATE INDEX `signal_snapshots_asset_time_idx` ON `signal_snapshots` (`assetSymbol`,`timeframe`,`candleCloseTime`);--> statement-breakpoint
CREATE INDEX `signal_snapshots_created_idx` ON `signal_snapshots` (`createdAt`);
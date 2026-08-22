CREATE TABLE IF NOT EXISTS `live_observations` (
	`id` varchar(96) NOT NULL,
	`assetSymbol` varchar(32) NOT NULL,
	`observedAt` timestamp NOT NULL,
	`conditionId` varchar(64) NOT NULL,
	`direction` varchar(16) NOT NULL,
	`score` double NOT NULL,
	`dataQualityState` varchar(32) NOT NULL,
	`evidenceJson` text NOT NULL,
	`sourceEventIdsJson` text NOT NULL,
	`configVersion` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `live_observations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `market_archive_manifests` (
	`id` varchar(96) NOT NULL,
	`streamType` varchar(24) NOT NULL,
	`assetSymbol` varchar(32) NOT NULL,
	`partitionStart` timestamp NOT NULL,
	`partitionEnd` timestamp NOT NULL,
	`objectKey` varchar(512) NOT NULL,
	`rowCount` int NOT NULL,
	`sha256` varchar(64) NOT NULL,
	`clickhouseBatchId` varchar(96) NOT NULL,
	`state` varchar(24) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `market_archive_manifests_id` PRIMARY KEY(`id`),
	CONSTRAINT `market_archive_manifests_objectKey_unique` UNIQUE(`objectKey`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `market_pipeline_health` (
	`component` varchar(24) NOT NULL,
	`state` varchar(24) NOT NULL,
	`lastSuccessAt` timestamp,
	`lastError` text,
	`lagMs` int,
	`summaryJson` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `market_pipeline_health_component` PRIMARY KEY(`component`)
);
--> statement-breakpoint
ALTER TABLE `bot_configs` ADD `liveAlertsJson` text;--> statement-breakpoint
UPDATE `bot_configs` SET `liveAlertsJson` = '{"enabled":false,"conditionIds":[],"threshold":0.65,"cooldownMinutes":15}' WHERE `liveAlertsJson` IS NULL;--> statement-breakpoint
ALTER TABLE `bot_configs` MODIFY `liveAlertsJson` text NOT NULL;--> statement-breakpoint
CREATE INDEX `live_observations_asset_time_idx` ON `live_observations` (`assetSymbol`,`observedAt`);--> statement-breakpoint
CREATE INDEX `market_archive_manifests_partition_idx` ON `market_archive_manifests` (`assetSymbol`,`partitionStart`);--> statement-breakpoint
CREATE INDEX `market_pipeline_health_state_updated_idx` ON `market_pipeline_health` (`state`,`updatedAt`);

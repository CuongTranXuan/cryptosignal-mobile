CREATE TABLE `candle_history` (
	`id` varchar(96) NOT NULL,
	`assetSymbol` varchar(32) NOT NULL,
	`venue` varchar(64) NOT NULL,
	`timeframe` varchar(12) NOT NULL,
	`candleCloseTime` timestamp NOT NULL,
	`open` double NOT NULL,
	`high` double NOT NULL,
	`low` double NOT NULL,
	`close` double NOT NULL,
	`volume` double NOT NULL,
	`ema20` double NOT NULL,
	`ema50` double NOT NULL,
	`ema200` double NOT NULL,
	`rsi14` double NOT NULL,
	`macd` double NOT NULL,
	`macdSignal` double NOT NULL,
	`atr14` double NOT NULL,
	`signalState` varchar(32) NOT NULL,
	`signalScore` double NOT NULL,
	`strategyVersion` varchar(32) NOT NULL,
	`configVersion` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `candle_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `candle_history_asset_time_idx` ON `candle_history` (`assetSymbol`,`timeframe`,`candleCloseTime`);--> statement-breakpoint
CREATE INDEX `candle_history_created_idx` ON `candle_history` (`createdAt`);
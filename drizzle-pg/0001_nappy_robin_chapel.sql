CREATE TYPE "public"."chart_annotation_source" AS ENUM('ENGINE', 'AGENT', 'DASHBOARD', 'SYSTEM');--> statement-breakpoint
CREATE TABLE "chart_annotations" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"assetSymbol" varchar(32) NOT NULL,
	"timeframe" varchar(12) NOT NULL,
	"candleCloseTime" timestamp with time zone NOT NULL,
	"kind" varchar(32) NOT NULL,
	"source" chart_annotation_source NOT NULL,
	"sourceFindingId" varchar(96),
	"payloadJson" text NOT NULL,
	"configVersion" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chart_annotations_asset_time_idx" ON "chart_annotations" USING btree ("assetSymbol","timeframe","candleCloseTime");
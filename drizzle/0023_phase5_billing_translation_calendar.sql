CREATE TABLE `calendarReminders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`eventId` varchar(255) NOT NULL,
	`title` varchar(255) NOT NULL,
	`startsAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`endsAt` timestamp,
	`notifiedAt` timestamp,
	`digestedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `calendarReminders_id` PRIMARY KEY(`id`),
	CONSTRAINT `calendarReminders_user_event_unique` UNIQUE(`userId`,`eventId`)
);
--> statement-breakpoint
CREATE TABLE `stripeEvents` (
	`id` varchar(255) NOT NULL,
	`type` varchar(64) NOT NULL,
	`processedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `stripeEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`stripeCustomerId` varchar(255) NOT NULL,
	`stripeSubscriptionId` varchar(255),
	`stripePriceId` varchar(255),
	`planId` varchar(16) NOT NULL DEFAULT 'free',
	`status` varchar(32) NOT NULL DEFAULT 'none',
	`currentPeriodStart` timestamp,
	`currentPeriodEnd` timestamp,
	`cancelAtPeriodEnd` boolean NOT NULL DEFAULT false,
	`lastEventAt` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `subscriptions_user_unique` UNIQUE(`userId`),
	CONSTRAINT `subscriptions_customer_unique` UNIQUE(`stripeCustomerId`)
);
--> statement-breakpoint
CREATE TABLE `translations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`kind` enum('transcript','guide','note') NOT NULL,
	`itemId` int NOT NULL,
	`recordingId` int,
	`language` varchar(10) NOT NULL,
	`chunkIndex` int NOT NULL,
	`sourceHash` varchar(64) NOT NULL,
	`content` mediumtext NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `translations_id` PRIMARY KEY(`id`),
	CONSTRAINT `translations_item_chunk_unique` UNIQUE(`kind`,`itemId`,`language`,`chunkIndex`)
);
--> statement-breakpoint
CREATE TABLE `usageEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`period` varchar(7) NOT NULL,
	`kind` enum('transcription','ai_generation') NOT NULL,
	`units` int NOT NULL,
	`recordingId` int,
	`dedupeKey` varchar(191),
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `usageEvents_id` PRIMARY KEY(`id`),
	CONSTRAINT `usageEvents_dedupe_unique` UNIQUE(`dedupeKey`)
);
--> statement-breakpoint
ALTER TABLE `integrationConnections` MODIFY COLUMN `provider` enum('notion','google_drive','google_calendar') NOT NULL;--> statement-breakpoint
CREATE INDEX `calendarReminders_starts_idx` ON `calendarReminders` (`startsAt`);--> statement-breakpoint
CREATE INDEX `subscriptions_subscription_idx` ON `subscriptions` (`stripeSubscriptionId`);--> statement-breakpoint
CREATE INDEX `translations_user_idx` ON `translations` (`userId`);--> statement-breakpoint
CREATE INDEX `translations_recording_idx` ON `translations` (`recordingId`);--> statement-breakpoint
CREATE INDEX `usageEvents_user_period_idx` ON `usageEvents` (`userId`,`period`);
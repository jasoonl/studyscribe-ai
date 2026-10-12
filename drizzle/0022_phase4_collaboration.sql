CREATE TABLE `groupShares` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`sharedBy` int NOT NULL,
	`itemType` enum('recording','course') NOT NULL,
	`itemId` int NOT NULL,
	`role` enum('view','comment','edit') NOT NULL DEFAULT 'view',
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `groupShares_id` PRIMARY KEY(`id`),
	CONSTRAINT `groupShares_group_item_unique` UNIQUE(`groupId`,`itemType`,`itemId`)
);
--> statement-breakpoint
CREATE TABLE `integrationConnections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` enum('notion','google_drive') NOT NULL,
	`accessToken` text NOT NULL,
	`refreshToken` text,
	`expiresAt` timestamp,
	`accountLabel` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integrationConnections_id` PRIMARY KEY(`id`),
	CONSTRAINT `integrationConnections_user_provider_unique` UNIQUE(`userId`,`provider`)
);
--> statement-breakpoint
CREATE TABLE `studyGroupMembers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('owner','member') NOT NULL DEFAULT 'member',
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `studyGroupMembers_id` PRIMARY KEY(`id`),
	CONSTRAINT `studyGroupMembers_group_user_unique` UNIQUE(`groupId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `studyGroups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`description` varchar(500),
	`joinToken` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `studyGroups_id` PRIMARY KEY(`id`),
	CONSTRAINT `studyGroups_joinToken_unique` UNIQUE(`joinToken`)
);
--> statement-breakpoint
CREATE TABLE `transcriptAnnotations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recordingId` int NOT NULL,
	`authorId` int NOT NULL,
	`parentId` int,
	`kind` enum('highlight','comment') NOT NULL DEFAULT 'comment',
	`segmentIndex` int NOT NULL,
	`segmentId` varchar(64),
	`startOffset` int NOT NULL,
	`endOffset` int NOT NULL,
	`quote` varchar(500) NOT NULL,
	`body` text,
	`resolved` boolean NOT NULL DEFAULT false,
	`resolvedBy` int,
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `transcriptAnnotations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `transcriptChunks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recordingId` int NOT NULL,
	`userId` int NOT NULL,
	`chunkIndex` int NOT NULL,
	`startSeconds` int,
	`text` text NOT NULL,
	`embedding` blob NOT NULL,
	`model` varchar(120) NOT NULL,
	`contentHash` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `transcriptChunks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `webhookDeliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`endpointId` int NOT NULL,
	`userId` int NOT NULL,
	`event` varchar(64) NOT NULL,
	`deliveryId` varchar(64) NOT NULL,
	`payload` mediumtext NOT NULL,
	`status` enum('pending','succeeded','failed') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`responseStatus` int,
	`error` varchar(500),
	`nextAttemptAt` timestamp,
	`lastAttemptAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `webhookDeliveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `webhookEndpoints` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`url` varchar(2048) NOT NULL,
	`description` varchar(120),
	`events` varchar(255) NOT NULL,
	`secret` text NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `webhookEndpoints_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `recordingShares` ADD `role` enum('view','comment','edit') DEFAULT 'view' NOT NULL;--> statement-breakpoint
CREATE INDEX `groupShares_item_idx` ON `groupShares` (`itemType`,`itemId`);--> statement-breakpoint
CREATE INDEX `studyGroupMembers_user_idx` ON `studyGroupMembers` (`userId`);--> statement-breakpoint
CREATE INDEX `studyGroups_owner_idx` ON `studyGroups` (`ownerId`);--> statement-breakpoint
CREATE INDEX `transcriptAnnotations_recording_idx` ON `transcriptAnnotations` (`recordingId`);--> statement-breakpoint
CREATE INDEX `transcriptAnnotations_author_idx` ON `transcriptAnnotations` (`authorId`);--> statement-breakpoint
CREATE INDEX `transcriptChunks_recording_idx` ON `transcriptChunks` (`recordingId`);--> statement-breakpoint
CREATE INDEX `transcriptChunks_user_idx` ON `transcriptChunks` (`userId`);--> statement-breakpoint
CREATE INDEX `webhookDeliveries_endpoint_idx` ON `webhookDeliveries` (`endpointId`);--> statement-breakpoint
CREATE INDEX `webhookDeliveries_user_idx` ON `webhookDeliveries` (`userId`);--> statement-breakpoint
CREATE INDEX `webhookDeliveries_due_idx` ON `webhookDeliveries` (`status`,`nextAttemptAt`);--> statement-breakpoint
CREATE INDEX `webhookEndpoints_user_idx` ON `webhookEndpoints` (`userId`);
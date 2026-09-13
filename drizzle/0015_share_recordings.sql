ALTER TABLE `recordings` ADD `publicShareToken` varchar(64);--> statement-breakpoint
ALTER TABLE `recordings` ADD CONSTRAINT `recordings_publicShareToken_unique` UNIQUE(`publicShareToken`);--> statement-breakpoint
CREATE TABLE `recordingShares` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recordingId` int NOT NULL,
	`ownerId` int NOT NULL,
	`sharedWithUserId` int NOT NULL,
	`sharedWithEmail` varchar(320) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `recordingShares_id` PRIMARY KEY(`id`),
	CONSTRAINT `recordingShares_recording_user_unique` UNIQUE(`recordingId`,`sharedWithUserId`)
);

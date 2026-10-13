CREATE TABLE `attendeeEmails` (
	`id` int AUTO_INCREMENT NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`recordingId` int NOT NULL,
	`userId` int NOT NULL,
	`noteId` int,
	`recipient` varchar(254) NOT NULL,
	`providerId` varchar(128),
	CONSTRAINT `attendeeEmails_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `emailOptOuts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`emailHash` varchar(64) NOT NULL,
	CONSTRAINT `emailOptOuts_id` PRIMARY KEY(`id`),
	CONSTRAINT `emailOptOuts_hash_unique` UNIQUE(`emailHash`)
);
--> statement-breakpoint
CREATE INDEX `attendeeEmails_recording_idx` ON `attendeeEmails` (`recordingId`);--> statement-breakpoint
CREATE INDEX `attendeeEmails_user_idx` ON `attendeeEmails` (`userId`,`createdAt`);
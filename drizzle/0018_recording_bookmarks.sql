CREATE TABLE `recordingBookmarks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recordingId` int NOT NULL,
	`userId` int NOT NULL,
	`atSeconds` int NOT NULL,
	`label` varchar(120),
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `recordingBookmarks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `recordingBookmarks_recording_idx` ON `recordingBookmarks` (`recordingId`);
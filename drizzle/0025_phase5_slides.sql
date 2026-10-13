CREATE TABLE `recordingSlides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`recordingId` int NOT NULL,
	`userId` int NOT NULL,
	`atSeconds` int NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`width` int NOT NULL,
	`height` int NOT NULL,
	`bytes` int NOT NULL,
	CONSTRAINT `recordingSlides_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `recordingSlides_recording_idx` ON `recordingSlides` (`recordingId`,`atSeconds`);--> statement-breakpoint
CREATE INDEX `recordingSlides_user_idx` ON `recordingSlides` (`userId`);
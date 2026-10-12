CREATE TABLE `followUpSuggestions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`recordingId` int NOT NULL,
	`kind` enum('review','practice','ask','read') NOT NULL DEFAULT 'review',
	`title` varchar(160) NOT NULL,
	`detail` varchar(500),
	`dueDate` date NOT NULL,
	`done` boolean NOT NULL DEFAULT false,
	`doneAt` timestamp,
	`remindedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `followUpSuggestions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `followUpSuggestions_user_idx` ON `followUpSuggestions` (`userId`);--> statement-breakpoint
CREATE INDEX `followUpSuggestions_recording_idx` ON `followUpSuggestions` (`recordingId`);
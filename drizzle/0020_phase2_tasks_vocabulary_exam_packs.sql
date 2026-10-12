CREATE TABLE `actionItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`recordingId` int NOT NULL,
	`text` varchar(500) NOT NULL,
	`kind` enum('task','assignment','exam','reading') NOT NULL DEFAULT 'task',
	`owner` varchar(120),
	`dueDate` date,
	`dueText` varchar(120),
	`atSeconds` int,
	`source` enum('extracted','manual') NOT NULL DEFAULT 'extracted',
	`done` boolean NOT NULL DEFAULT false,
	`doneAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `actionItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `examPacks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`courseId` int,
	`recordingIds` json NOT NULL,
	`guide` text,
	`questions` json,
	`lastScore` int,
	`attempts` int NOT NULL DEFAULT 0,
	`lastAttemptAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `examPacks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vocabularyLists` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`recordingId` int,
	`terms` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `vocabularyLists_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `actionItems_user_idx` ON `actionItems` (`userId`);--> statement-breakpoint
CREATE INDEX `actionItems_recording_idx` ON `actionItems` (`recordingId`);--> statement-breakpoint
CREATE INDEX `examPacks_user_idx` ON `examPacks` (`userId`);--> statement-breakpoint
CREATE INDEX `vocabularyLists_user_idx` ON `vocabularyLists` (`userId`);
CREATE TABLE `practiceSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`mode` enum('review','timed') NOT NULL,
	`scope` enum('quiz','pack','course','missed') NOT NULL,
	`quizId` int,
	`packId` int,
	`courseId` int,
	`parentSessionId` int,
	`title` varchar(255) NOT NULL,
	`questions` json NOT NULL,
	`recordingIds` json,
	`timeLimitSeconds` int,
	`extraTimePercent` int NOT NULL DEFAULT 100,
	`targetCount` int,
	`openKey` varchar(16),
	`startedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`deadlineAt` timestamp,
	`submittedAt` timestamp,
	`autoSubmitted` boolean NOT NULL DEFAULT false,
	`answers` json,
	`score` int,
	`results` json,
	`similarClaimedAt` timestamp,
	`similarAddedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `practiceSessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `practiceSessions_user_open_unique` UNIQUE(`userId`,`openKey`)
);
--> statement-breakpoint
CREATE TABLE `questionExplanations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`inputHash` varchar(64) NOT NULL,
	`attemptKey` varchar(64) NOT NULL,
	`questionId` varchar(20) NOT NULL,
	`recordingId` int,
	`status` enum('ready','not_covered') NOT NULL,
	`text` text,
	`citations` json,
	`model` varchar(80) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `questionExplanations_id` PRIMARY KEY(`id`),
	CONSTRAINT `questionExplanations_user_hash_unique` UNIQUE(`userId`,`inputHash`)
);
--> statement-breakpoint
CREATE INDEX `practiceSessions_user_created_idx` ON `practiceSessions` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `practiceSessions_user_parent_idx` ON `practiceSessions` (`userId`,`parentSessionId`);--> statement-breakpoint
CREATE INDEX `questionExplanations_user_recording_idx` ON `questionExplanations` (`userId`,`recordingId`);--> statement-breakpoint
CREATE INDEX `questionExplanations_user_attempt_idx` ON `questionExplanations` (`userId`,`attemptKey`);
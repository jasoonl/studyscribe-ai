CREATE TABLE `chatHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recordingId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('user','assistant') NOT NULL,
	`content` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chatHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `flashcards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recordingId` int NOT NULL,
	`userId` int NOT NULL,
	`question` text NOT NULL,
	`answer` text NOT NULL,
	`difficulty` enum('easy','medium','hard') DEFAULT 'medium',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `flashcards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recordings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`audioUrl` text NOT NULL,
	`audioKey` varchar(512) NOT NULL,
	`duration` int,
	`audience` enum('student','professional') DEFAULT 'student',
	`status` enum('processing','completed','failed') DEFAULT 'processing',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recordings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `studyNotes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recordingId` int NOT NULL,
	`userId` int NOT NULL,
	`type` enum('summary','key_concepts','action_items','formulas','study_guide') NOT NULL,
	`content` text NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `studyNotes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `transcripts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recordingId` int NOT NULL,
	`userId` int NOT NULL,
	`fullText` text NOT NULL,
	`segments` json,
	`language` varchar(10) DEFAULT 'en',
	`status` enum('processing','completed','failed') DEFAULT 'processing',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `transcripts_id` PRIMARY KEY(`id`)
);

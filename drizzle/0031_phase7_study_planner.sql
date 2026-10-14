CREATE TABLE `flashcardSchedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`flashcardId` int NOT NULL,
	`recordingId` int NOT NULL,
	`dueDate` date NOT NULL,
	`intervalDays` int NOT NULL DEFAULT 1,
	`easeX100` int NOT NULL DEFAULT 250,
	`reps` int NOT NULL DEFAULT 0,
	`lapses` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `flashcardSchedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `flashcardSchedules_user_card_unique` UNIQUE(`userId`,`flashcardId`)
);
--> statement-breakpoint
CREATE TABLE `studyEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`kind` enum('flashcard','quiz') NOT NULL,
	`recordingId` int,
	`flashcardId` int,
	`quizId` int,
	`result` int NOT NULL,
	`seconds` int NOT NULL DEFAULT 0,
	`localDate` date NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `studyEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `flashcardSchedules_user_due_idx` ON `flashcardSchedules` (`userId`,`dueDate`);--> statement-breakpoint
CREATE INDEX `flashcardSchedules_recording_idx` ON `flashcardSchedules` (`recordingId`);--> statement-breakpoint
CREATE INDEX `studyEvents_user_date_idx` ON `studyEvents` (`userId`,`localDate`);--> statement-breakpoint
CREATE INDEX `studyEvents_recording_idx` ON `studyEvents` (`recordingId`);
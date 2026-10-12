CREATE TABLE `courses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`color` varchar(16) NOT NULL DEFAULT 'blue',
	`term` varchar(64),
	`archived` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `courses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recordingCourses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recordingId` int NOT NULL,
	`courseId` int NOT NULL,
	`userId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `recordingCourses_id` PRIMARY KEY(`id`),
	CONSTRAINT `recordingCourses_recording_unique` UNIQUE(`recordingId`)
);
--> statement-breakpoint
ALTER TABLE `chatHistory` MODIFY COLUMN `recordingId` int;--> statement-breakpoint
CREATE INDEX `courses_user_idx` ON `courses` (`userId`);--> statement-breakpoint
CREATE INDEX `recordingCourses_course_idx` ON `recordingCourses` (`courseId`);
CREATE TABLE `studySourceFlags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceId` int NOT NULL,
	`userId` int NOT NULL,
	`partIndex` int NOT NULL,
	`unitIndex` int NOT NULL,
	`label` varchar(80) NOT NULL,
	`kind` enum('definition','formula','date','example','exam_point') NOT NULL,
	`text` varchar(400) NOT NULL,
	`quote` varchar(240),
	`importance` tinyint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `studySourceFlags_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `studySourceParts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceId` int NOT NULL,
	`userId` int NOT NULL,
	`partIndex` int NOT NULL,
	`unitStart` int NOT NULL,
	`unitEnd` int NOT NULL,
	`inputHash` varchar(64) NOT NULL,
	`ideas` mediumtext NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `studySourceParts_id` PRIMARY KEY(`id`),
	CONSTRAINT `studySourceParts_source_part_unique` UNIQUE(`sourceId`,`partIndex`)
);
--> statement-breakpoint
CREATE TABLE `studySourceUnits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceId` int NOT NULL,
	`userId` int NOT NULL,
	`unitIndex` int NOT NULL,
	`label` varchar(80) NOT NULL,
	`text` mediumtext NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `studySourceUnits_id` PRIMARY KEY(`id`),
	CONSTRAINT `studySourceUnits_source_unit_unique` UNIQUE(`sourceId`,`unitIndex`)
);
--> statement-breakpoint
CREATE TABLE `studySources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`courseId` int,
	`title` varchar(200) NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`kind` enum('pdf','pptx','docx','text') NOT NULL,
	`storageKey` varchar(300) NOT NULL,
	`sizeBytes` int NOT NULL,
	`status` enum('uploaded','extracting','extracted','analyzing','ready','failed') NOT NULL DEFAULT 'uploaded',
	`unitCount` int NOT NULL DEFAULT 0,
	`charCount` int NOT NULL DEFAULT 0,
	`partCount` int NOT NULL DEFAULT 0,
	`partsDone` int NOT NULL DEFAULT 0,
	`errorMessage` varchar(300),
	`summary` mediumtext,
	`contentHash` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `studySources_id` PRIMARY KEY(`id`),
	CONSTRAINT `studySources_storageKey_unique` UNIQUE(`storageKey`)
);
--> statement-breakpoint
CREATE INDEX `studySourceFlags_source_idx` ON `studySourceFlags` (`sourceId`);--> statement-breakpoint
CREATE INDEX `studySourceFlags_user_idx` ON `studySourceFlags` (`userId`);--> statement-breakpoint
CREATE INDEX `studySourceParts_user_idx` ON `studySourceParts` (`userId`);--> statement-breakpoint
CREATE INDEX `studySourceUnits_user_idx` ON `studySourceUnits` (`userId`);--> statement-breakpoint
CREATE INDEX `studySources_user_course_idx` ON `studySources` (`userId`,`courseId`);
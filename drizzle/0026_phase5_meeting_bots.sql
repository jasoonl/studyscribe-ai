CREATE TABLE `meetingBots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	`userId` int NOT NULL,
	`recallBotId` varchar(128),
	`meetingUrl` varchar(1024) NOT NULL,
	`platform` varchar(32) NOT NULL,
	`title` varchar(255) NOT NULL,
	`botName` varchar(100) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'scheduled',
	`statusDetail` varchar(255),
	`joinAt` timestamp,
	`calendarEventId` varchar(255),
	`attendees` text,
	`recordingId` int,
	`lastCheckedAt` timestamp,
	`lastEventAt` int NOT NULL DEFAULT 0,
	CONSTRAINT `meetingBots_id` PRIMARY KEY(`id`),
	CONSTRAINT `meetingBots_recall_unique` UNIQUE(`recallBotId`)
);
--> statement-breakpoint
CREATE TABLE `recordingEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`recordingId` int NOT NULL,
	`userId` int NOT NULL,
	`source` enum('calendar','meeting_bot') NOT NULL,
	`eventId` varchar(255),
	`title` varchar(255) NOT NULL,
	`startsAt` timestamp,
	`attendees` text,
	CONSTRAINT `recordingEvents_id` PRIMARY KEY(`id`),
	CONSTRAINT `recordingEvents_recording_unique` UNIQUE(`recordingId`)
);
--> statement-breakpoint
CREATE INDEX `meetingBots_user_idx` ON `meetingBots` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `recordingEvents_user_idx` ON `recordingEvents` (`userId`);
CREATE TABLE `notePages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(200) NOT NULL,
	`body` mediumtext NOT NULL,
	`courseId` int,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `notePages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `notePages_user_updated_idx` ON `notePages` (`userId`,`updatedAt`);
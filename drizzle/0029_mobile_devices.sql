CREATE TABLE `appleIdentities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`appleSub` varchar(255) NOT NULL,
	`email` varchar(320),
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `appleIdentities_id` PRIMARY KEY(`id`),
	CONSTRAINT `appleIdentities_sub_unique` UNIQUE(`appleSub`)
);
--> statement-breakpoint
CREATE TABLE `deviceTokens` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`platform` enum('ios','android') NOT NULL,
	`token` varchar(255) NOT NULL,
	`appVersion` varchar(32),
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`lastSeenAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `deviceTokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `deviceTokens_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE INDEX `appleIdentities_user_idx` ON `appleIdentities` (`userId`);--> statement-breakpoint
CREATE INDEX `deviceTokens_user_idx` ON `deviceTokens` (`userId`);
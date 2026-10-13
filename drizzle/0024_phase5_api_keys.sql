CREATE TABLE `apiKeys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`prefix` varchar(16) NOT NULL,
	`keyHash` varchar(64) NOT NULL,
	`scope` enum('read','write') NOT NULL DEFAULT 'read',
	`lastUsedAt` timestamp,
	`requestCount` int NOT NULL DEFAULT 0,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `apiKeys_id` PRIMARY KEY(`id`),
	CONSTRAINT `apiKeys_hash_unique` UNIQUE(`keyHash`)
);
--> statement-breakpoint
CREATE INDEX `apiKeys_user_idx` ON `apiKeys` (`userId`);
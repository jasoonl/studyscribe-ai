CREATE TABLE `sessionRevocations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`sid` varchar(32),
	`cutoffAt` timestamp,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `sessionRevocations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `sessionRevocations_user_idx` ON `sessionRevocations` (`userId`);
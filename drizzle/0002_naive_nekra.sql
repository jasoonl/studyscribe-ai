ALTER TABLE `recordings` ADD `isDeleted` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `recordings` ADD `deletedAt` timestamp;
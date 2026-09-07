CREATE TABLE `flashcardReviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`flashcardId` int NOT NULL,
	`recordingId` int NOT NULL,
	`status` enum('new','learning','mastered') NOT NULL DEFAULT 'new',
	`reviewCount` int NOT NULL DEFAULT 0,
	`lastReviewedAt` timestamp,
	`masteredAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `flashcardReviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `flashcardReviews_user_flashcard_unique` UNIQUE(`userId`,`flashcardId`)
);

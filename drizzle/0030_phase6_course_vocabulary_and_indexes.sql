CREATE TABLE `courseVocabularies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`courseId` int NOT NULL,
	`userId` int NOT NULL,
	`terms` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `courseVocabularies_id` PRIMARY KEY(`id`),
	CONSTRAINT `courseVocabularies_course_unique` UNIQUE(`courseId`)
);
--> statement-breakpoint
CREATE INDEX `courseVocabularies_user_idx` ON `courseVocabularies` (`userId`);--> statement-breakpoint
CREATE INDEX `chatHistory_user_recording_idx` ON `chatHistory` (`userId`,`recordingId`);--> statement-breakpoint
CREATE INDEX `emailDrafts_recording_idx` ON `emailDrafts` (`recordingId`);--> statement-breakpoint
CREATE INDEX `flashcards_recording_idx` ON `flashcards` (`recordingId`);--> statement-breakpoint
CREATE INDEX `flashcards_user_idx` ON `flashcards` (`userId`);--> statement-breakpoint
CREATE INDEX `quizAttempts_quiz_idx` ON `quizAttempts` (`quizId`);--> statement-breakpoint
CREATE INDEX `quizzes_recording_idx` ON `quizzes` (`recordingId`);--> statement-breakpoint
CREATE INDEX `recordingShares_shared_with_idx` ON `recordingShares` (`sharedWithUserId`);--> statement-breakpoint
CREATE INDEX `recordingTags_recording_idx` ON `recordingTags` (`recordingId`);--> statement-breakpoint
CREATE INDEX `recordings_user_created_idx` ON `recordings` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `recordings_audio_key_idx` ON `recordings` (`audioKey`);--> statement-breakpoint
CREATE INDEX `studyGuides_recording_idx` ON `studyGuides` (`recordingId`);--> statement-breakpoint
CREATE INDEX `studyNotes_recording_idx` ON `studyNotes` (`recordingId`);--> statement-breakpoint
CREATE INDEX `studyNotes_user_idx` ON `studyNotes` (`userId`);--> statement-breakpoint
CREATE INDEX `tags_user_idx` ON `tags` (`userId`);--> statement-breakpoint
CREATE INDEX `transcriptChunks_user_model_idx` ON `transcriptChunks` (`userId`,`model`);--> statement-breakpoint
CREATE INDEX `transcripts_recording_idx` ON `transcripts` (`recordingId`);--> statement-breakpoint
CREATE INDEX `userNotifications_user_read_idx` ON `userNotifications` (`userId`,`isRead`);
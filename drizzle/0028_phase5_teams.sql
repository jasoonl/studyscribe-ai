CREATE TABLE `organizationCourses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`orgId` int NOT NULL,
	`courseId` int NOT NULL,
	`sharedBy` int NOT NULL,
	CONSTRAINT `organizationCourses_id` PRIMARY KEY(`id`),
	CONSTRAINT `organizationCourses_org_course_unique` UNIQUE(`orgId`,`courseId`)
);
--> statement-breakpoint
CREATE TABLE `organizationInvites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`expiresAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`orgId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`role` enum('admin','member') NOT NULL DEFAULT 'member',
	`tokenHash` varchar(64) NOT NULL,
	`invitedBy` int NOT NULL,
	`acceptedAt` timestamp,
	CONSTRAINT `organizationInvites_id` PRIMARY KEY(`id`),
	CONSTRAINT `organizationInvites_token_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `organizationMembers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`orgId` int NOT NULL,
	`userId` int NOT NULL,
	`role` enum('owner','admin','member') NOT NULL DEFAULT 'member',
	CONSTRAINT `organizationMembers_id` PRIMARY KEY(`id`),
	CONSTRAINT `organizationMembers_user_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	`name` varchar(120) NOT NULL,
	`ownerId` int NOT NULL,
	`verifiedDomain` varchar(253),
	`pendingDomain` varchar(253),
	`domainToken` varchar(64),
	`domainVerifiedAt` timestamp,
	`autoJoin` boolean NOT NULL DEFAULT false,
	`restrictToDomain` boolean NOT NULL DEFAULT false,
	`workosOrganizationId` varchar(64),
	`stripeCustomerId` varchar(255),
	`stripeSubscriptionId` varchar(255),
	`subscriptionStatus` varchar(32) NOT NULL DEFAULT 'none',
	`seats` int NOT NULL DEFAULT 0,
	`currentPeriodEnd` timestamp,
	`cancelAtPeriodEnd` boolean NOT NULL DEFAULT false,
	`lastEventAt` int NOT NULL DEFAULT 0,
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`),
	CONSTRAINT `organizations_domain_unique` UNIQUE(`verifiedDomain`),
	CONSTRAINT `organizations_workos_unique` UNIQUE(`workosOrganizationId`),
	CONSTRAINT `organizations_customer_unique` UNIQUE(`stripeCustomerId`)
);
--> statement-breakpoint
CREATE INDEX `organizationCourses_course_idx` ON `organizationCourses` (`courseId`);--> statement-breakpoint
CREATE INDEX `organizationInvites_org_idx` ON `organizationInvites` (`orgId`);--> statement-breakpoint
CREATE INDEX `organizationInvites_email_idx` ON `organizationInvites` (`email`);--> statement-breakpoint
CREATE INDEX `organizationMembers_org_idx` ON `organizationMembers` (`orgId`);--> statement-breakpoint
CREATE INDEX `organizations_owner_idx` ON `organizations` (`ownerId`);
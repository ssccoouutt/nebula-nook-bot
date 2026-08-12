CREATE TABLE `botSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(128) NOT NULL,
	`value` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `botSettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `botSettings_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `botUsers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`telegramUserId` bigint NOT NULL,
	`username` varchar(255),
	`firstName` varchar(255),
	`lastName` varchar(255),
	`referralCode` varchar(32) NOT NULL,
	`referredById` int,
	`tier` enum('Bronze','Silver','Gold') NOT NULL DEFAULT 'Bronze',
	`balanceCents` int NOT NULL DEFAULT 0,
	`accessGranted` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `botUsers_id` PRIMARY KEY(`id`),
	CONSTRAINT `botUsers_telegramUserId_unique` UNIQUE(`telegramUserId`),
	CONSTRAINT `botUsers_referralCode_unique` UNIQUE(`referralCode`),
	CONSTRAINT `botUsers_referral_code_idx` UNIQUE(`referralCode`)
);
--> statement-breakpoint
CREATE TABLE `broadcasts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`message` text NOT NULL,
	`status` enum('queued','sending','completed','failed') NOT NULL DEFAULT 'queued',
	`sentCount` int NOT NULL DEFAULT 0,
	`failedCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `broadcasts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `freeClaims` (
	`id` int AUTO_INCREMENT NOT NULL,
	`botUserId` int NOT NULL,
	`productId` int NOT NULL,
	`windowStartMs` bigint NOT NULL,
	`status` enum('claimed','fulfilled','cancelled') NOT NULL DEFAULT 'claimed',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `freeClaims_id` PRIMARY KEY(`id`),
	CONSTRAINT `freeClaims_user_product_window_idx` UNIQUE(`botUserId`,`productId`,`windowStartMs`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`botUserId` int NOT NULL,
	`productId` int NOT NULL,
	`kind` enum('purchase','free') NOT NULL,
	`amountCents` int NOT NULL,
	`status` enum('pending','paid','fulfilled','cancelled') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`priceCents` int NOT NULL,
	`stock` int NOT NULL DEFAULT 0,
	`active` int NOT NULL DEFAULT 1,
	`freeEligible` int NOT NULL DEFAULT 0,
	`freeWindowMs` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `referrals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`referrerId` int NOT NULL,
	`referredUserId` int NOT NULL,
	`bonusCents` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `referrals_id` PRIMARY KEY(`id`),
	CONSTRAINT `referrals_referredUserId_unique` UNIQUE(`referredUserId`)
);
--> statement-breakpoint
CREATE TABLE `supportTickets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`botUserId` int NOT NULL,
	`message` text NOT NULL,
	`status` enum('open','in_progress','closed') NOT NULL DEFAULT 'open',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `supportTickets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `walletLedger` (
	`id` int AUTO_INCREMENT NOT NULL,
	`botUserId` int NOT NULL,
	`amountCents` int NOT NULL,
	`kind` enum('topup','purchase','refund','referral_bonus','adjustment') NOT NULL,
	`referenceId` varchar(128),
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `walletLedger_id` PRIMARY KEY(`id`)
);

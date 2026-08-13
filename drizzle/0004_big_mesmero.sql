CREATE TABLE `binancePayDeposits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`botUserId` int NOT NULL,
	`transactionId` varchar(128) NOT NULL,
	`amountCents` int NOT NULL,
	`asset` varchar(16) NOT NULL,
	`status` enum('verified','rejected') NOT NULL DEFAULT 'verified',
	`rawStatus` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `binancePayDeposits_id` PRIMARY KEY(`id`),
	CONSTRAINT `binancePayDeposits_transactionId_unique` UNIQUE(`transactionId`)
);

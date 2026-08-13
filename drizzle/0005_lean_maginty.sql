CREATE TABLE `paymentIntents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`botUserId` int NOT NULL,
	`productId` int NOT NULL,
	`quantity` int NOT NULL,
	`amountCents` int NOT NULL,
	`method` enum('binance_pay') NOT NULL,
	`status` enum('pending','paid','fulfilled','cancelled','expired') NOT NULL DEFAULT 'pending',
	`transactionId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `paymentIntents_id` PRIMARY KEY(`id`),
	CONSTRAINT `paymentIntents_transactionId_unique` UNIQUE(`transactionId`)
);

CREATE TABLE `priceAlerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`botUserId` int NOT NULL,
	`productId` int NOT NULL,
	`active` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `priceAlerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `priceAlerts_user_product_idx` UNIQUE(`botUserId`,`productId`)
);

CREATE TABLE `notificationDeliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`botUserId` int,
	`adminChatId` bigint,
	`eventType` varchar(64) NOT NULL,
	`referenceId` varchar(128) NOT NULL,
	`status` enum('queued','sent','failed') NOT NULL DEFAULT 'queued',
	`error` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`sentAt` timestamp,
	CONSTRAINT `notificationDeliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `notificationDeliveries_event_reference_idx` UNIQUE(`eventType`,`referenceId`)
);
--> statement-breakpoint
ALTER TABLE `broadcasts` ADD `scheduleCronTaskUid` varchar(65);
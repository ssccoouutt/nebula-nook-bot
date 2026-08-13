CREATE TABLE "binancePayDeposits" (
	"id" serial PRIMARY KEY NOT NULL,
	"botUserId" integer NOT NULL,
	"transactionId" varchar(128) NOT NULL,
	"amountCents" integer NOT NULL,
	"asset" varchar(16) NOT NULL,
	"status" text DEFAULT 'verified' NOT NULL,
	"rawStatus" varchar(64),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "binancePayDeposits_transactionId_unique" UNIQUE("transactionId")
);
--> statement-breakpoint
CREATE TABLE "botSettings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(128) NOT NULL,
	"value" text NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "botSettings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "botUsers" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegramUserId" bigint NOT NULL,
	"username" varchar(255),
	"firstName" varchar(255),
	"lastName" varchar(255),
	"referralCode" varchar(32) NOT NULL,
	"referredById" integer,
	"tier" text DEFAULT 'Bronze' NOT NULL,
	"balanceCents" integer DEFAULT 0 NOT NULL,
	"accessGranted" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "botUsers_telegramUserId_unique" UNIQUE("telegramUserId"),
	CONSTRAINT "botUsers_referralCode_unique" UNIQUE("referralCode")
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"sentCount" integer DEFAULT 0 NOT NULL,
	"failedCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone,
	"scheduleCronTaskUid" varchar(65)
);
--> statement-breakpoint
CREATE TABLE "freeClaims" (
	"id" serial PRIMARY KEY NOT NULL,
	"botUserId" integer NOT NULL,
	"productId" integer NOT NULL,
	"windowStartMs" bigint NOT NULL,
	"status" text DEFAULT 'claimed' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notificationDeliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"botUserId" integer,
	"adminChatId" bigint,
	"eventType" varchar(64) NOT NULL,
	"referenceId" varchar(128) NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"sentAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"botUserId" integer NOT NULL,
	"productId" integer NOT NULL,
	"kind" text NOT NULL,
	"amountCents" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paymentIntents" (
	"id" serial PRIMARY KEY NOT NULL,
	"botUserId" integer NOT NULL,
	"productId" integer NOT NULL,
	"quantity" integer NOT NULL,
	"amountCents" integer NOT NULL,
	"method" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"transactionId" varchar(128),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paymentIntents_transactionId_unique" UNIQUE("transactionId")
);
--> statement-breakpoint
CREATE TABLE "priceAlerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"botUserId" integer NOT NULL,
	"productId" integer NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"priceCents" integer NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"freeEligible" integer DEFAULT 0 NOT NULL,
	"freeWindowMs" bigint,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"referrerId" integer NOT NULL,
	"referredUserId" integer NOT NULL,
	"bonusCents" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_referredUserId_unique" UNIQUE("referredUserId")
);
--> statement-breakpoint
CREATE TABLE "supportTickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"botUserId" integer NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" text DEFAULT 'user' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE TABLE "walletLedger" (
	"id" serial PRIMARY KEY NOT NULL,
	"botUserId" integer NOT NULL,
	"amountCents" integer NOT NULL,
	"kind" text NOT NULL,
	"referenceId" varchar(128),
	"note" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "botUsers_referral_code_idx" ON "botUsers" USING btree ("referralCode");--> statement-breakpoint
CREATE UNIQUE INDEX "freeClaims_user_product_window_idx" ON "freeClaims" USING btree ("botUserId","productId","windowStartMs");--> statement-breakpoint
CREATE UNIQUE INDEX "notificationDeliveries_event_reference_idx" ON "notificationDeliveries" USING btree ("eventType","referenceId");--> statement-breakpoint
CREATE UNIQUE INDEX "priceAlerts_user_product_idx" ON "priceAlerts" USING btree ("botUserId","productId");
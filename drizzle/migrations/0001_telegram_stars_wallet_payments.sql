CREATE TABLE IF NOT EXISTS "telegramStarsWalletPayments" (
  "id" serial PRIMARY KEY NOT NULL,
  "botUserId" bigint NOT NULL,
  "amountCents" integer NOT NULL,
  "starsAmount" integer NOT NULL,
  "payload" varchar(128) NOT NULL,
  "transactionId" varchar(128),
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "telegramStarsWalletPayments_payload_unique" UNIQUE("payload"),
  CONSTRAINT "telegramStarsWalletPayments_transactionId_unique" UNIQUE("transactionId")
);

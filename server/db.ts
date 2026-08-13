import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let _client: PGlite | null = null;
let _ready: Promise<ReturnType<typeof drizzle> | null> | null = null;

const storageDir = process.env.KOYEB_DATA_DIR || path.resolve(process.cwd(), "data", "nebula-nook");

const schemaSql = `
CREATE TABLE IF NOT EXISTS users (id serial PRIMARY KEY, "openId" varchar(64) NOT NULL UNIQUE, name text, email varchar(320), "loginMethod" varchar(64), role text NOT NULL DEFAULT 'user', "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), "lastSignedIn" timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS "botUsers" (id serial PRIMARY KEY, "telegramUserId" bigint NOT NULL UNIQUE, username varchar(255), "firstName" varchar(255), "lastName" varchar(255), "referralCode" varchar(32) NOT NULL UNIQUE, "referredById" integer, tier text NOT NULL DEFAULT 'Bronze', "balanceCents" integer NOT NULL DEFAULT 0, "accessGranted" integer NOT NULL DEFAULT 0, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS "botSettings" (id serial PRIMARY KEY, key varchar(128) NOT NULL UNIQUE, value text NOT NULL, "updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS products (id serial PRIMARY KEY, name varchar(255) NOT NULL, description text NOT NULL, "priceCents" integer NOT NULL, stock integer NOT NULL DEFAULT 0, active integer NOT NULL DEFAULT 1, "freeEligible" integer NOT NULL DEFAULT 0, "freeWindowMs" bigint, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS "freeClaims" (id serial PRIMARY KEY, "botUserId" integer NOT NULL, "productId" integer NOT NULL, "windowStartMs" bigint NOT NULL, status text NOT NULL DEFAULT 'claimed', "createdAt" timestamptz NOT NULL DEFAULT now(), UNIQUE ("botUserId", "productId", "windowStartMs"));
CREATE TABLE IF NOT EXISTS orders (id serial PRIMARY KEY, "botUserId" integer NOT NULL, "productId" integer NOT NULL, kind text NOT NULL, "amountCents" integer NOT NULL, status text NOT NULL DEFAULT 'pending', "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS "walletLedger" (id serial PRIMARY KEY, "botUserId" integer NOT NULL, "amountCents" integer NOT NULL, kind text NOT NULL, "referenceId" varchar(128), note text, "createdAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS "binancePayDeposits" (id serial PRIMARY KEY, "botUserId" integer NOT NULL, "transactionId" varchar(128) NOT NULL UNIQUE, "amountCents" integer NOT NULL, asset varchar(16) NOT NULL, status text NOT NULL DEFAULT 'verified', "rawStatus" varchar(64), "createdAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS "paymentIntents" (id serial PRIMARY KEY, "botUserId" integer NOT NULL, "productId" integer NOT NULL, quantity integer NOT NULL, "amountCents" integer NOT NULL, method text NOT NULL, status text NOT NULL DEFAULT 'pending', "transactionId" varchar(128) UNIQUE, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS referrals (id serial PRIMARY KEY, "referrerId" integer NOT NULL, "referredUserId" integer NOT NULL UNIQUE, "bonusCents" integer NOT NULL DEFAULT 0, "createdAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS "priceAlerts" (id serial PRIMARY KEY, "botUserId" integer NOT NULL, "productId" integer NOT NULL, active integer NOT NULL DEFAULT 1, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), UNIQUE ("botUserId", "productId"));
CREATE TABLE IF NOT EXISTS "supportTickets" (id serial PRIMARY KEY, "botUserId" integer NOT NULL, message text NOT NULL, status text NOT NULL DEFAULT 'open', "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS broadcasts (id serial PRIMARY KEY, message text NOT NULL, status text NOT NULL DEFAULT 'queued', "sentCount" integer NOT NULL DEFAULT 0, "failedCount" integer NOT NULL DEFAULT 0, "createdAt" timestamptz NOT NULL DEFAULT now(), "completedAt" timestamptz, "scheduleCronTaskUid" varchar(65));
CREATE TABLE IF NOT EXISTS "notificationDeliveries" (id serial PRIMARY KEY, "botUserId" integer, "adminChatId" bigint, "eventType" varchar(64) NOT NULL, "referenceId" varchar(128) NOT NULL, status text NOT NULL DEFAULT 'queued', error text, "createdAt" timestamptz NOT NULL DEFAULT now(), "sentAt" timestamptz, UNIQUE ("eventType", "referenceId"));
`;

async function initialize() {
  await mkdir(storageDir, { recursive: true });
  _client = new PGlite(storageDir);
  await _client.waitReady;
  await _client.exec(schemaSql);
  _db = drizzle(_client);
  console.warn(`[Storage] Using Koyeb-local PGlite data at ${storageDir}. Data is lost if this filesystem is recycled.`);
  return _db;
}

export async function getDb() {
  if (_db) return _db;
  if (!_ready) _ready = initialize().catch((error) => { console.error("[Storage] Failed to initialize local PGlite:", error); _db = null; return null; });
  return _ready;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) throw new Error("Koyeb-local storage is unavailable");
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) { values[field] = user[field] ?? null; updateSet[field] = values[field]; }
  }
  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
  else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (!Object.keys(updateSet).length) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onConflictDoUpdate({ target: users.openId, set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

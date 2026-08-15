import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { eq } from "drizzle-orm";
import { InsertUser, users } from "../drizzle/schema";
import * as schema from "../drizzle/schema";
import { ENV } from "./_core/env";

type AppSchema = typeof schema;
type AppDb = ReturnType<typeof drizzle<AppSchema>>;

let _db: AppDb | null = null;
type DatabaseClient = InstanceType<typeof DatabaseSync>;
let _client: DatabaseClient | null = null;

type SqliteParam = null | number | string | Uint8Array;

export function normalizeSqliteParams(params: unknown[]): SqliteParam[] {
  return params.map(value => {
    if (value === undefined) return null;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "bigint") return Number(value);
    return value as SqliteParam;
  });
}

export function normalizeSqliteRow(row: Record<string, unknown> | undefined) {
  return row ? Object.values(row) : undefined;
}
let _ready: Promise<AppDb | null> | null = null;

const storageDir = process.env.KOYEB_DATA_DIR || path.resolve(process.cwd(), "data", "nebula-nook");
const storageFile = path.join(storageDir, "nebula-nook.sqlite");

const schemaSql = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, openId TEXT NOT NULL UNIQUE, name TEXT, email TEXT, loginMethod TEXT, role TEXT NOT NULL DEFAULT 'user', createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000), updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000), lastSignedIn INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000));
CREATE TABLE IF NOT EXISTS botUsers (id INTEGER PRIMARY KEY AUTOINCREMENT, telegramUserId INTEGER NOT NULL UNIQUE, username TEXT, firstName TEXT, lastName TEXT, referralCode TEXT NOT NULL UNIQUE, referredById INTEGER, tier TEXT NOT NULL DEFAULT 'Bronze', balanceCents INTEGER NOT NULL DEFAULT 0, referralCredits INTEGER NOT NULL DEFAULT 0, accessGranted INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000), updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000));
CREATE TABLE IF NOT EXISTS botSettings (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, value TEXT NOT NULL, updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000));
CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', deliveryFormat TEXT NOT NULL DEFAULT '', priceCents INTEGER NOT NULL, stock INTEGER NOT NULL DEFAULT 0, inventoryText TEXT NOT NULL DEFAULT '', deliveryMode TEXT NOT NULL DEFAULT 'automatic', warrantyDays INTEGER NOT NULL DEFAULT 0, imageUrl TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, freeEligible INTEGER NOT NULL DEFAULT 0, freeWindowMs INTEGER, referralEligible INTEGER NOT NULL DEFAULT 0, referralPriceCredits INTEGER NOT NULL DEFAULT 1, createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000), updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000));
CREATE TABLE IF NOT EXISTS freeClaims (id INTEGER PRIMARY KEY AUTOINCREMENT, botUserId INTEGER NOT NULL, productId INTEGER NOT NULL, windowStartMs INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'claimed', createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000), UNIQUE (botUserId, productId, windowStartMs));
CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, botUserId INTEGER NOT NULL, productId INTEGER NOT NULL, kind TEXT NOT NULL, amountCents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000), updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000));
CREATE TABLE IF NOT EXISTS walletLedger (id INTEGER PRIMARY KEY AUTOINCREMENT, botUserId INTEGER NOT NULL, amountCents INTEGER NOT NULL, kind TEXT NOT NULL, referenceId TEXT, note TEXT, createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000));
CREATE TABLE IF NOT EXISTS binancePayDeposits (id INTEGER PRIMARY KEY AUTOINCREMENT, botUserId INTEGER NOT NULL, transactionId TEXT NOT NULL UNIQUE, amountCents INTEGER NOT NULL, asset TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'verified', rawStatus TEXT, createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000));
CREATE TABLE IF NOT EXISTS paymentIntents (id INTEGER PRIMARY KEY AUTOINCREMENT, botUserId INTEGER NOT NULL, productId INTEGER NOT NULL, quantity INTEGER NOT NULL, amountCents INTEGER NOT NULL, method TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', transactionId TEXT UNIQUE, createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000), updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000));
CREATE TABLE IF NOT EXISTS referrals (id INTEGER PRIMARY KEY AUTOINCREMENT, referrerId INTEGER NOT NULL, referredUserId INTEGER NOT NULL UNIQUE, bonusCents INTEGER NOT NULL DEFAULT 0, creditsAwarded INTEGER NOT NULL DEFAULT 1, createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000));
CREATE TABLE IF NOT EXISTS priceAlerts (id INTEGER PRIMARY KEY AUTOINCREMENT, botUserId INTEGER NOT NULL, productId INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000), updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000), UNIQUE (botUserId, productId));
CREATE TABLE IF NOT EXISTS supportTickets (id INTEGER PRIMARY KEY AUTOINCREMENT, botUserId INTEGER NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000), updatedAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000));
CREATE TABLE IF NOT EXISTS broadcasts (id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', sentCount INTEGER NOT NULL DEFAULT 0, failedCount INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000), completedAt INTEGER, scheduleCronTaskUid TEXT);
CREATE TABLE IF NOT EXISTS notificationDeliveries (id INTEGER PRIMARY KEY AUTOINCREMENT, botUserId INTEGER, adminChatId INTEGER, eventType TEXT NOT NULL, referenceId TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', error TEXT, createdAt INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000), sentAt INTEGER, UNIQUE (eventType, referenceId));
`;

function ensureReferralColumns(client: DatabaseClient) {
  const botUserColumns = new Set((client.prepare("PRAGMA table_info(botUsers)").all() as Array<{ name: string }>).map(column => column.name));
  if (!botUserColumns.has("referralCredits")) client.exec("ALTER TABLE botUsers ADD COLUMN referralCredits INTEGER NOT NULL DEFAULT 0");
  const productColumns = new Set((client.prepare("PRAGMA table_info(products)").all() as Array<{ name: string }>).map(column => column.name));
  if (!productColumns.has("referralEligible")) client.exec("ALTER TABLE products ADD COLUMN referralEligible INTEGER NOT NULL DEFAULT 0");
  if (!productColumns.has("referralPriceCredits")) client.exec("ALTER TABLE products ADD COLUMN referralPriceCredits INTEGER NOT NULL DEFAULT 1");
  const referralColumns = new Set((client.prepare("PRAGMA table_info(referrals)").all() as Array<{ name: string }>).map(column => column.name));
  if (!referralColumns.has("creditsAwarded")) client.exec("ALTER TABLE referrals ADD COLUMN creditsAwarded INTEGER NOT NULL DEFAULT 1");
}

function ensureProductColumns(client: DatabaseClient) {
  const columns = new Set((client.prepare("PRAGMA table_info(products)").all() as Array<{ name: string }>).map(column => column.name));
  const additions: Array<[string, string]> = [
    ["details", "TEXT NOT NULL DEFAULT ''"],
    ["deliveryFormat", "TEXT NOT NULL DEFAULT ''"],
    ["inventoryText", "TEXT NOT NULL DEFAULT ''"],
    ["deliveryMode", "TEXT NOT NULL DEFAULT 'automatic'"],
    ["warrantyDays", "INTEGER NOT NULL DEFAULT 0"],
    ["imageUrl", "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, definition] of additions) {
    if (!columns.has(name)) client.exec(`ALTER TABLE products ADD COLUMN "${name}" ${definition}`);
  }
  if (!columns.has("deliveryFormat")) client.exec("UPDATE products SET deliveryFormat = details WHERE trim(deliveryFormat) = '' AND trim(details) <> ''");
}

async function initialize(): Promise<AppDb> {
  await mkdir(storageDir, { recursive: true });
  _client = new DatabaseSync(storageFile);
  _client.exec(schemaSql);
  ensureReferralColumns(_client);
  ensureProductColumns(_client);
  const client = _client;
  const db = drizzle<AppSchema>(async (sql, params, method) => {
    const statement = client.prepare(sql);
    const normalizedParams = normalizeSqliteParams(params);
    if (method === "run") {
      const result = statement.run(...normalizedParams);
      return { rows: [], changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
    }
    if (method === "get") {
      const row = statement.get(...normalizedParams) as Record<string, unknown> | undefined;
      return { rows: normalizeSqliteRow(row) as any };
    }
    const rows = statement.all(...normalizedParams) as Record<string, unknown>[];
    if (method === "values") return { rows: rows.map((row) => normalizeSqliteRow(row)) as any };
    return { rows: rows.map((row) => normalizeSqliteRow(row)) as any };
  }, { schema });
  _db = db;
  console.warn(`[Storage] Using Koyeb-local Node SQLite data at ${storageFile}. Data is lost if this filesystem is recycled.`);
  return db;
}

export async function getDb() {
  if (_db) return _db;
  if (!_ready) _ready = initialize().catch((error) => { console.error("[Storage] Failed to initialize local SQLite:", error); _db = null; return null; });
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

import { google } from "googleapis";
import { createReadStream, createWriteStream } from "node:fs";
import { createRequire } from "node:module";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { buildReadableExports } from "./googleDriveExports";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const ROOT_FOLDER_NAME = "Nebula Nook Bot";
const SNAPSHOTS_FOLDER_NAME = "snapshots";
const METADATA_FOLDER_NAME = "metadata";
const EXPORTS_FOLDER_NAME = "exports";
const LATEST_SNAPSHOT_NAME = "latest.sqlite";
const MANIFEST_NAME = "latest.json";
const READABLE_EXPORTS: Array<[string, string]> = [
  ["users", "users.json"], ["botUsers", "bot_users.json"], ["products", "products.json"],
  ["orders", "orders.json"], ["walletLedger", "wallet_ledger.json"], ["binancePayDeposits", "deposits.json"],
  ["paymentIntents", "payment_intents.json"], ["referrals", "referrals.json"], ["freeClaims", "free_claims.json"],
  ["priceAlerts", "price_alerts.json"], ["supportTickets", "support_tickets.json"], ["broadcasts", "broadcasts.json"],
  ["notificationDeliveries", "notification_deliveries.json"], ["botSettings", "settings.json"],
];
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

let initialized = false;
let initPromise: Promise<void> | null = null;
let syncTimer: NodeJS.Timeout | null = null;
let syncInFlight: Promise<void> | null = null;
let syncRequested = false;
let folderIds: { root: string; snapshots: string; metadata: string; exports: string } | null = null;

export async function withRetry<T>(operation: () => Promise<T>, label: string, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 250 * attempt));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export function isValidSqliteSnapshot(bytes: Uint8Array) {
  const header = Buffer.from(bytes.subarray(0, 16));
  return header.subarray(0, 15).toString("ascii") === "SQLite format 3" && header[15] === 0;
}

function driveTokenUrl() {
  return process.env.DRIVE?.trim() || "";
}

function localDatabasePath() {
  const storageDir = process.env.KOYEB_DATA_DIR || path.resolve(process.cwd(), "data", "nebula-nook");
  return path.join(storageDir, "nebula-nook.sqlite");
}

function configured() {
  return Boolean(driveTokenUrl());
}

async function driveClient() {
  const url = driveTokenUrl();
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Drive token download failed with HTTP ${response.status}`);
  const tokenData = await response.json() as Record<string, unknown>;
  const clientId = String(tokenData.client_id || tokenData.clientId || "");
  const clientSecret = String(tokenData.client_secret || tokenData.clientSecret || "");
  const refreshToken = String(tokenData.refresh_token || tokenData.refreshToken || "");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Drive token JSON must contain client_id, client_secret, and refresh_token");
  }
  const oauth = new google.auth.OAuth2(clientId, clientSecret, String(tokenData.redirect_uri || "urn:ietf:wg:oauth:2.0:oob"));
  oauth.setCredentials({
    access_token: typeof tokenData.token === "string" ? tokenData.token : typeof tokenData.access_token === "string" ? tokenData.access_token : undefined,
    expiry_date: typeof tokenData.expiry_date === "number" ? tokenData.expiry_date : tokenData.expiry ? new Date(String(tokenData.expiry)).getTime() : undefined,
    refresh_token: refreshToken,
  });
  return google.drive({ version: "v3", auth: oauth });
}

async function findOrCreateFolder(drive: ReturnType<typeof google.drive>, name: string, parentId?: string) {
  const parentClause = parentId ? `'${parentId}' in parents` : "'root' in parents";
  const result = await drive.files.list({
    q: `name = '${name.replaceAll("'", "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and ${parentClause} and trashed = false`,
    spaces: "drive",
    fields: "files(id,name)",
    pageSize: 10,
  });
  const existing = result.data.files?.[0]?.id;
  if (existing) return existing;
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: "id",
  });
  if (!created.data.id) throw new Error(`Drive folder creation returned no ID for ${name}`);
  return created.data.id;
}

async function ensureFolders() {
  const drive = await driveClient();
  if (!drive) return null;
  const root = await findOrCreateFolder(drive, ROOT_FOLDER_NAME);
  const snapshots = await findOrCreateFolder(drive, SNAPSHOTS_FOLDER_NAME, root);
  const metadata = await findOrCreateFolder(drive, METADATA_FOLDER_NAME, root);
  const exports = await findOrCreateFolder(drive, EXPORTS_FOLDER_NAME, root);
  folderIds = { root, snapshots, metadata, exports };
  return { drive, ids: folderIds };
}

async function findFile(drive: ReturnType<typeof google.drive>, name: string, parentId: string) {
  const result = await drive.files.list({
    q: `name = '${name.replaceAll("'", "\\'")}' and '${parentId}' in parents and trashed = false`,
    spaces: "drive",
    fields: "files(id,name,modifiedTime,size)",
    pageSize: 10,
  });
  return result.data.files?.[0] || null;
}

async function downloadSnapshot(drive: ReturnType<typeof google.drive>, fileId: string, destination: string) {
  const response = await withRetry(() => drive.files.get({ fileId, alt: "media" }, { responseType: "stream" }), "Drive snapshot download");
  await pipeline(response.data as NodeJS.ReadableStream, createWriteStream(destination));
  const bytes = await readFile(destination);
  if (!isValidSqliteSnapshot(bytes)) throw new Error("Downloaded Drive snapshot is not a valid SQLite database");
}

async function downloadText(drive: ReturnType<typeof google.drive>, fileId: string) {
  const response = await withRetry(() => drive.files.get({ fileId, alt: "media" }, { responseType: "text" }), "Drive export download");
  return String(response.data ?? "");
}

export function databaseHasUserData(databasePath: string) {
  try {
    const client = new DatabaseSync(databasePath, { readOnly: true });
    const tables = client.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('botUsers','products','orders','walletLedger','binancePayDeposits','paymentIntents')").all() as Array<{ name: string }>;
    const count = tables.reduce((total, table) => total + Number((client.prepare(`SELECT COUNT(*) AS count FROM "${table.name}"`).get() as { count: number }).count), 0);
    client.close();
    return count > 0;
  } catch {
    return false;
  }
}

export function shouldRestoreReadableExportRow(table: string, row: Record<string, unknown>) {
  // A fallback export may contain a cursor from a previous Telegram runtime. Keeping it
  // can make Telegram redeliveries and fresh updates appear stale after Drive recovery.
  return !(table === "botSettings" && row.key === "last_update_id");
}

async function restoreReadableExports(setup: { drive: ReturnType<typeof google.drive>; ids: { exports: string } }, databasePath: string) {
  const downloaded: Array<[string, unknown[]]> = [];
  for (const [table, fileName] of READABLE_EXPORTS) {
    const file = await findFile(setup.drive, fileName, setup.ids.exports);
    if (!file?.id) continue;
    const content = await downloadText(setup.drive, file.id);
    try {
      const rows = JSON.parse(content);
      if (Array.isArray(rows) && rows.length) downloaded.push([table, rows]);
    } catch {
      console.warn(`[Drive] Ignoring invalid readable export ${fileName}.`);
    }
  }
  if (!downloaded.length) return 0;
  await mkdir(path.dirname(databasePath), { recursive: true });
  const client = new DatabaseSync(databasePath);
  let inserted = 0;
  try {
    const tableNames = new Set(downloaded.map(([table]) => table));
    for (const table of ["users", "botUsers", "botSettings", "products", "orders", "walletLedger", "binancePayDeposits", "paymentIntents", "referrals", "freeClaims", "priceAlerts", "supportTickets", "broadcasts", "notificationDeliveries"]) {
      if (!tableNames.has(table)) continue;
      const columns = (client.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map(column => column.name);
      for (const row of downloaded.find(([name]) => name === table)?.[1] as Array<Record<string, unknown>>) {
        if (!shouldRestoreReadableExportRow(table, row)) continue;
        const keys = Object.keys(row).filter(key => columns.includes(key));
        if (!keys.length) continue;
        const placeholders = keys.map(() => "?").join(",");
        const values = keys.map(key => row[key] === undefined ? null : row[key]);
        client.prepare(`INSERT OR IGNORE INTO "${table}" (${keys.map(key => `"${key}"`).join(",")}) VALUES (${placeholders})`).run(...values as any[]);
        inserted += 1;
      }
    }
  } finally {
    client.close();
  }
  return inserted;
}

async function restoreLatestSnapshot() {
  const setup = await ensureFolders();
  if (!setup) return;
  const file = await findFile(setup.drive, LATEST_SNAPSHOT_NAME, setup.ids.snapshots);
  if (!file?.id) {
    const databasePath = localDatabasePath();
    if (databaseHasUserData(databasePath)) {
      console.log("[Drive] No binary snapshot found; preserving existing local SQLite data.");
      return;
    }
    // Create only the empty schema first; rows are then restored from Drive before the server starts serving requests.
    await import("./db").then(({ getDb }) => getDb());
    const restoredRows = await restoreReadableExports(setup, databasePath);
    if (restoredRows > 0) {
      console.log(`[Drive] Restored ${restoredRows} records from human-readable exports before SQLite initialization.`);
      return;
    }
    console.log("[Drive] No SQLite snapshot or readable exports found; starting with a new local database.");
    return;
  }
  const databasePath = localDatabasePath();
  const tempPath = `${databasePath}.drive-restore.tmp`;
  await mkdir(path.dirname(databasePath), { recursive: true });
  await downloadSnapshot(setup.drive, file.id, tempPath);
  const downloaded = await stat(tempPath);
  if (downloaded.size < 4096) {
    await unlink(tempPath).catch(() => undefined);
    throw new Error("Drive snapshot is unexpectedly small; refusing to replace local database");
  }
  if (!databaseHasUserData(tempPath)) {
    await unlink(tempPath).catch(() => undefined);
    await import("./db").then(({ getDb }) => getDb());
    const restoredRows = await restoreReadableExports(setup, databasePath);
    if (restoredRows > 0) {
      console.log(`[Drive] Latest snapshot was empty; restored ${restoredRows} records from human-readable exports.`);
      return;
    }
    console.log("[Drive] Latest snapshot contains no business data and no readable exports were available; starting with an empty database.");
    return;
  }
  await rename(tempPath, databasePath);
  console.log(`[Drive] Restored ${LATEST_SNAPSHOT_NAME} (${downloaded.size} bytes) before SQLite initialization.`);
}

async function uploadOrUpdate(drive: ReturnType<typeof google.drive>, name: string, parentId: string, filePath: string, mimeType: string) {
  const existing = await findFile(drive, name, parentId);
  const media = { mimeType, body: createReadStream(filePath) };
  if (existing?.id) {
    await withRetry(() => drive.files.update({ fileId: existing.id!, media }), `Drive update ${name}`);
    return existing.id;
  }
  const created = await withRetry(() => drive.files.create({
    requestBody: { name, mimeType, parents: [parentId] },
    media,
    fields: "id",
  }), `Drive create ${name}`);
  return created.data.id || null;
}

async function uploadTextOrUpdate(drive: ReturnType<typeof google.drive>, name: string, parentId: string, content: string, mimeType: string) {
  const existing = await findFile(drive, name, parentId);
  const media = { mimeType, body: Readable.from([content]) };
  if (existing?.id) {
    await withRetry(() => drive.files.update({ fileId: existing.id!, media }), `Drive update ${name}`);
    return existing.id;
  }
  const created = await withRetry(() => drive.files.create({
    requestBody: { name, mimeType, parents: [parentId] },
    media,
    fields: "id",
  }), `Drive create ${name}`);
  return created.data.id || null;
}

async function syncNow() {
  if (!configured() || !folderIds) return;
  if (syncInFlight) {
    syncRequested = true;
    return syncInFlight;
  }
  syncInFlight = (async () => {
    const setup = await ensureFolders();
    if (!setup) return;
    const databasePath = localDatabasePath();
    try {
      const info = await stat(databasePath);
      if (info.size < 4096) return;
      const readableExports = buildReadableExports();
      for (const [fileName, content] of Object.entries(readableExports)) {
        await uploadTextOrUpdate(setup.drive, fileName, setup.ids.exports, content, fileName.endsWith(".txt") ? "text/plain" : "application/json");
      }
      const versionedSnapshotName = `snapshot-${new Date().toISOString().replaceAll(/[-:.TZ]/g, "")}-${Math.random().toString(36).slice(2, 8)}.sqlite`;
      await uploadOrUpdate(setup.drive, versionedSnapshotName, setup.ids.snapshots, databasePath, "application/x-sqlite3");
      await uploadOrUpdate(setup.drive, LATEST_SNAPSHOT_NAME, setup.ids.snapshots, databasePath, "application/x-sqlite3");
      const manifestPath = `${databasePath}.manifest.json`;
      await writeFile(manifestPath, JSON.stringify({
        application: "nebula-nook-bot",
        database: LATEST_SNAPSHOT_NAME,
        historicalSnapshot: versionedSnapshotName,
        bytes: info.size,
        syncedAt: new Date().toISOString(),
      }, null, 2));
      await uploadOrUpdate(setup.drive, MANIFEST_NAME, setup.ids.metadata, manifestPath, "application/json");
      await unlink(manifestPath).catch(() => undefined);
      console.log(`[Drive] Synchronized SQLite snapshot (${info.size} bytes).`);
    } finally {
      syncInFlight = null;
      if (syncRequested) {
        syncRequested = false;
        scheduleDriveSync();
      }
    }
  })().catch(error => {
    syncInFlight = null;
    console.error("[Drive] Snapshot synchronization failed:", error instanceof Error ? error.message : error);
  });
  return syncInFlight;
}

export async function initializeDrivePersistence() {
  if (!configured() || initialized) return;
  if (!initPromise) {
    initPromise = restoreLatestSnapshot().then(() => {
      initialized = true;
    }).catch(error => {
      console.error("[Drive] Startup restore failed; refusing to start with potentially divergent local data:", error instanceof Error ? error.message : error);
      throw error;
    });
  }
  await initPromise;
}

export function scheduleDriveSync() {
  if (!configured() || !initialized) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void syncNow();
  }, 1500);
}

export async function flushDriveSync() {
  if (!configured()) return;
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  await syncNow();
}

export function drivePersistenceStatus() {
  return { configured: configured(), folderName: ROOT_FOLDER_NAME, initialized };
}

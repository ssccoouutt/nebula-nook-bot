import { google } from "googleapis";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const ROOT_FOLDER_NAME = "Nebula Nook Bot";
const SNAPSHOTS_FOLDER_NAME = "snapshots";
const METADATA_FOLDER_NAME = "metadata";
const LATEST_SNAPSHOT_NAME = "latest.sqlite";
const MANIFEST_NAME = "latest.json";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

let initialized = false;
let initPromise: Promise<void> | null = null;
let syncTimer: NodeJS.Timeout | null = null;
let syncInFlight: Promise<void> | null = null;
let syncRequested = false;
let folderIds: { root: string; snapshots: string; metadata: string } | null = null;

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
  folderIds = { root, snapshots, metadata };
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
  const response = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
  await pipeline(response.data as NodeJS.ReadableStream, createWriteStream(destination));
}

async function restoreLatestSnapshot() {
  const setup = await ensureFolders();
  if (!setup) return;
  const file = await findFile(setup.drive, LATEST_SNAPSHOT_NAME, setup.ids.snapshots);
  if (!file?.id) {
    console.log("[Drive] No existing SQLite snapshot found; starting with a new local database.");
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
  await rename(tempPath, databasePath);
  console.log(`[Drive] Restored ${LATEST_SNAPSHOT_NAME} (${downloaded.size} bytes) before SQLite initialization.`);
}

async function uploadOrUpdate(drive: ReturnType<typeof google.drive>, name: string, parentId: string, filePath: string, mimeType: string) {
  const existing = await findFile(drive, name, parentId);
  const media = { mimeType, body: createReadStream(filePath) };
  if (existing?.id) {
    await drive.files.update({ fileId: existing.id, media });
    return existing.id;
  }
  const created = await drive.files.create({
    requestBody: { name, mimeType, parents: [parentId] },
    media,
    fields: "id",
  });
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

import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { DRIVE_SYNC_DEBOUNCE_MS, drivePersistenceStatus, databaseHasUserData, initializeDrivePersistence, isValidSqliteSnapshot, scheduleDriveSync, shouldPreferReadableExports, shouldPreferReadableExportsByData, shouldRestoreReadableExportRow, withRetry } from "./googleDrivePersistence";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

describe("Google Drive persistence", () => {
  const previousDrive = process.env.DRIVE;

  afterEach(() => {
    if (previousDrive === undefined) delete process.env.DRIVE;
    else process.env.DRIVE = previousDrive;
  });

  it("retries transient Drive failures and eventually succeeds", async () => {
    let attempts = 0;
    await expect(withRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("temporary failure");
      return "ok";
    }, "test operation")).resolves.toBe("ok");
    expect(attempts).toBe(3);
  });

  it("rejects corrupted snapshots and accepts the SQLite magic header", () => {
    const valid = new Uint8Array(16);
    new TextEncoder().encodeInto("SQLite format 3", valid);
    expect(isValidSqliteSnapshot(valid)).toBe(true);
    expect(isValidSqliteSnapshot(new TextEncoder().encode("not sqlite"))).toBe(false);
  });

  it("does not treat an empty schema as restored historical data", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "nebula-drive-"));
    const databasePath = path.join(directory, "empty.sqlite");
    const client = new DatabaseSync(databasePath);
    client.exec("CREATE TABLE botUsers (id INTEGER PRIMARY KEY, telegramUserId INTEGER NOT NULL)");
    client.close();
    expect(databaseHasUserData(databasePath)).toBe(false);
    await rm(directory, { recursive: true, force: true });
  });

  it("recognizes restored user data as durable business data", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "nebula-drive-"));
    const databasePath = path.join(directory, "restored.sqlite");
    const client = new DatabaseSync(databasePath);
    client.exec("CREATE TABLE botUsers (id INTEGER PRIMARY KEY, telegramUserId INTEGER NOT NULL); INSERT INTO botUsers (id, telegramUserId) VALUES (1, 12345)");
    client.close();
    expect(databaseHasUserData(databasePath)).toBe(true);
    await rm(directory, { recursive: true, force: true });
  });

  it("prefers a newer readable export set over an older binary snapshot", () => {
    expect(shouldPreferReadableExports("2026-08-17T06:00:00.000Z", ["2026-08-17T06:00:01.000Z"])).toBe(true);
    expect(shouldPreferReadableExports("2026-08-17T06:00:00.000Z", ["2026-08-16T23:59:59.000Z"])).toBe(false);
    expect(shouldPreferReadableExports("2026-08-17T06:00:00.000Z", [undefined, "2026-08-17T06:00:02.000Z"])).toBe(true);
  });

  it("prefers a larger readable export dataset even when timestamps are not newer", () => {
    expect(shouldPreferReadableExportsByData(
      { botUsers: 44, orders: 5, products: 2 },
      { botUsers: 45, orders: 7, products: 3 },
    )).toBe(true);
    expect(shouldPreferReadableExportsByData(
      { botUsers: 45, orders: 7, products: 3 },
      { botUsers: 44, orders: 7, products: 3 },
    )).toBe(false);
  });

  it("does not restore a stale Telegram update cursor from readable exports", () => {
    expect(shouldRestoreReadableExportRow("botSettings", { key: "last_update_id", value: "999999999" })).toBe(false);
    expect(shouldRestoreReadableExportRow("botSettings", { key: "membership_group_id", value: "-100123" })).toBe(true);
    expect(shouldRestoreReadableExportRow("products", { key: "last_update_id", value: "999999999" })).toBe(true);
  });

  it("uses a five-second debounce so bursty writes coalesce before full exports", () => {
    expect(DRIVE_SYNC_DEBOUNCE_MS).toBe(5_000);
  });

  it("stays a no-op when the single DRIVE setting is absent", async () => {
    delete process.env.DRIVE;
    await initializeDrivePersistence();
    scheduleDriveSync();
    expect(drivePersistenceStatus()).toMatchObject({ configured: false, folderName: "Nebula Nook Bot" });
  });
});

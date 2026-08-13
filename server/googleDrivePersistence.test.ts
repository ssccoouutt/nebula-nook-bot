import { afterEach, describe, expect, it } from "vitest";
import { drivePersistenceStatus, initializeDrivePersistence, isValidSqliteSnapshot, scheduleDriveSync, withRetry } from "./googleDrivePersistence";

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

  it("stays a no-op when the single DRIVE setting is absent", async () => {
    delete process.env.DRIVE;
    await initializeDrivePersistence();
    scheduleDriveSync();
    expect(drivePersistenceStatus()).toMatchObject({ configured: false, folderName: "Nebula Nook Bot" });
  });
});

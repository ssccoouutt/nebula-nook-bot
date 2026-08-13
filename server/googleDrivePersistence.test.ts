import { afterEach, describe, expect, it } from "vitest";
import { drivePersistenceStatus, initializeDrivePersistence, scheduleDriveSync } from "./googleDrivePersistence";

describe("Google Drive persistence", () => {
  const previousDrive = process.env.DRIVE;

  afterEach(() => {
    if (previousDrive === undefined) delete process.env.DRIVE;
    else process.env.DRIVE = previousDrive;
  });

  it("stays a no-op when the single DRIVE setting is absent", async () => {
    delete process.env.DRIVE;
    await initializeDrivePersistence();
    scheduleDriveSync();
    expect(drivePersistenceStatus()).toMatchObject({ configured: false, folderName: "Nebula Nook Bot" });
  });
});

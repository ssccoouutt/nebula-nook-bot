import { describe, expect, it } from "vitest";
import { broadcastDeliveryLabel, normalizeBroadcastRecipients } from "./broadcast";

describe("broadcast delivery helpers", () => {
  it("keeps only unique positive safe Telegram IDs", () => {
    expect(normalizeBroadcastRecipients([123, 123, null, undefined, 0, -9, 456, 1.5])).toEqual([123, 456]);
  });

  it("formats delivery totals for dashboard feedback", () => {
    expect(broadcastDeliveryLabel(44, 1)).toBe("44 sent, 1 failed");
    expect(broadcastDeliveryLabel(0, 3)).toBe("0 sent, 3 failed");
  });
});

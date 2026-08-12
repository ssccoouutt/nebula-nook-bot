import { describe, expect, it } from "vitest";
import {
  canClaimFreeItem,
  freeWindowStart,
  hasAccess,
  referralCodeForTelegramId,
  tierForReferralCount,
} from "../shared/botLogic";

describe("bot domain rules", () => {
  it("requires membership in both configured spaces", () => {
    expect(hasAccess("member", "administrator")).toBe(true);
    expect(hasAccess("member", "left")).toBe(false);
    expect(hasAccess("unknown", "member")).toBe(false);
  });

  it("aligns claims to the start of the current free window", () => {
    expect(freeWindowStart(9_999, 10_000)).toBe(0);
    expect(freeWindowStart(10_001, 10_000)).toBe(10_000);
    expect(canClaimFreeItem(null, 10_001, 10_000)).toBe(true);
    expect(canClaimFreeItem(10_500, 19_999, 10_000)).toBe(false);
    expect(canClaimFreeItem(10_500, 20_001, 10_000)).toBe(true);
  });

  it("creates stable referral codes and applies exact tier thresholds", () => {
    expect(referralCodeForTelegramId(123456)).toBe("NN2N9C");
    expect(tierForReferralCount(0)).toBe("Bronze");
    expect(tierForReferralCount(5)).toBe("Silver");
    expect(tierForReferralCount(25)).toBe("Gold");
  });
});

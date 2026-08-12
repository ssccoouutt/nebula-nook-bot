export type MembershipStatus = "member" | "administrator" | "creator" | "restricted" | "left" | "kicked" | "unknown";

export function hasRequiredMembership(status: MembershipStatus | undefined): boolean {
  return status === "member" || status === "administrator" || status === "creator";
}

export function hasAccess(channelStatus: MembershipStatus | undefined, groupStatus: MembershipStatus | undefined): boolean {
  return hasRequiredMembership(channelStatus) && hasRequiredMembership(groupStatus);
}

export function freeWindowStart(nowMs: number, windowMs: number): number {
  if (!Number.isFinite(nowMs) || !Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("nowMs and windowMs must be finite, and windowMs must be positive");
  }
  return Math.floor(nowMs / windowMs) * windowMs;
}

export function canClaimFreeItem(lastClaimAtMs: number | null | undefined, nowMs: number, windowMs: number): boolean {
  const currentWindow = freeWindowStart(nowMs, windowMs);
  return lastClaimAtMs == null || lastClaimAtMs < currentWindow;
}

export function referralCodeForTelegramId(telegramUserId: number): string {
  if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
    throw new Error("telegramUserId must be a positive safe integer");
  }
  return `NN${telegramUserId.toString(36).toUpperCase()}`;
}

export function tierForReferralCount(referralCount: number): "Bronze" | "Silver" | "Gold" {
  if (referralCount >= 25) return "Gold";
  if (referralCount >= 5) return "Silver";
  return "Bronze";
}

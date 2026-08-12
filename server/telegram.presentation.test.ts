import { describe, expect, it } from "vitest";
import {
  formatExtraDeviceMessage,
  formatHomeMessage,
  formatMembershipMessage,
  formatSupportPrompt,
  formatSupportSubmitted,
  resolveNotificationChatId,
} from "./telegram";

describe("Telegram presentation and notification helpers", () => {
  it("resolves the configured operations group before runtime and fallback targets", () => {
    expect(resolveNotificationChatId("-100123", "-200456", "-300789")).toBe(-100123);
    expect(resolveNotificationChatId(undefined, "-200456", "-300789")).toBe(-200456);
    expect(resolveNotificationChatId(undefined, undefined, "-300789")).toBe(-300789);
    expect(resolveNotificationChatId("not-a-chat", undefined, "0")).toBeNull();
  });

  it("keeps core messages emoji-led and HTML formatted", () => {
    expect(formatHomeMessage()).toContain("✨ <b>Welcome to Nebula Nook</b>");
    expect(formatMembershipMessage()).toContain("🔐 <b>Membership required</b>");
    expect(formatSupportPrompt()).toContain("🆘 <b>Support</b>");
    expect(formatSupportSubmitted("42")).toContain("✅ <b>Support request received</b>");
    expect(formatExtraDeviceMessage()).toContain("📱 <b>Extra device request</b>");
  });
});

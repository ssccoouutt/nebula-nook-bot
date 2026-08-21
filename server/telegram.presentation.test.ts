import { describe, expect, it, vi } from "vitest";
import {
  buildAutoPurchaseResult,
  buildConfirmedPurchasePlan,
  buildFulfillmentNotifications,
  buildPurchaseAnnouncement,
  maskPurchaseName,
  formatFreebieClaimNotification,
  formatReferralRewardNotification,
  formatQualifiedReferralNotification,
  productEmoji,
  formatExtraDeviceMessage,
  formatHomeMessage,
  formatMembershipMessage,
  formatOrderStatus,
  formatDetailedOrder,
  formatPurchaseConfirmation,
  normalizeWarrantyText,
  formatShopSummary,
  SHOP_PAGE_SIZE,
  formatSupportPrompt,
  formatSupportSubmitted,
  resolveNotificationChatId,
      diagnoseConfiguredAdminChatId,
    resolveConfiguredAdminChatId,

  buildHomeKeyboard,
  buildAdminKeyboard,
  formatAdminHomeMessage,
  parseAdminReplyCommand,
  isAuthorizedAdminMessage,
  buildMembershipKeyboard,
  buildShopKeyboard,
  buildProductKeyboard,
  buildQuantityKeyboard,
  buildPaymentMethodKeyboard,
  usdCentsToTelegramStars,
  formatBotInfoMessage,
  buildUnavailableProductKeyboard,
  formatQuantityPrompt,
  formatCustomQuantityPrompt,
  parseCustomQuantityInput,
  resolveCustomQuantityReply,
  resolvePriceAlertToggle,
  formatPriceAlertMessage,
  formatPurchaseReview,
  formatBinancePayPurchasePrompt,
  formatBep20PurchasePrompt,
  BEP20_PURCHASE_WINDOW_MS,
  BINANCE_PAY_PURCHASE_WINDOW_MS,
  formatBinancePayTopupPrompt,
  formatBep20TopupPrompt,
  formatTelegramStarsTopupPrompt,
  buildTelegramStarsTopupKeyboard,
  buildWalletKeyboard,
  buildWalletDepositAmountKeyboard,
  buildWalletDepositInvoiceKeyboard,
  formatWalletDepositAmountPrompt,
  parseUsdAmountInput,
  formatFreebiesMessage,
  formatProductAvailabilityAnnouncement,
  buildFreebiesKeyboard,
  telegramResponseMethod,
  respond,
  rememberNonTextCallbackMessage,
  parseTelegramCallbackAction,
  resolvePurchaseCallbackRoute,
  isPurchasableProduct,
  isShopEligibleProduct,
  extractInsertedRowId,
  didInsertReferralRow,
  consumeDigitalInventory,
  buildPurchasePaymentFailureKeyboard,
  hasProductImage,
  isHttpProductImageUrl,
  enabledPaymentOptions,
  parsePaymentOptionsList,
  isPaymentOptionEnabled,
  paymentOptionForCallback,
  formatPaymentUnavailableMessage,
} from "./telegram";

describe("Telegram presentation and notification helpers", () => {
  it("normalizes legacy numeric and current text warranties safely", () => {
    expect(normalizeWarrantyText(30)).toBe("30 days");
    expect(normalizeWarrantyText(0)).toBe("");
    expect(normalizeWarrantyText("30 Minutes")).toBe("30 Minutes");
    expect(normalizeWarrantyText(" no warranty ")).toBe("no warranty");
    expect(normalizeWarrantyText(null)).toBe("");
  });

  it("renders legacy numeric warranty values in purchase confirmations", () => {
    const text = formatPurchaseConfirmation("42", "Gemini", 100, { mode: "automatic", items: ["activation-link"], warrantyDays: 30 });
    expect(text).toContain("Warranty: <b>30 days</b>");
  });

  it("rejects unavailable products consistently without rejecting stocked active items", () => {
    expect(isPurchasableProduct({ active: 1, stock: 12 })).toBe(true);
    expect(isPurchasableProduct({ active: 1, stock: 0 })).toBe(false);
    expect(isPurchasableProduct({ active: 0, stock: 12 })).toBe(false);
    expect(isPurchasableProduct(undefined)).toBe(false);
  });

  it("offers a current Shop recovery action for stale unavailable-product buttons", () => {
    const markup = buildUnavailableProductKeyboard();
    expect(markup.inline_keyboard[0][0]).toMatchObject({ text: "🛍️ Open current Shop", callback_data: "shop:0", style: "primary" });
    expect(markup.inline_keyboard[1][0]).toMatchObject({ text: "↩️ Back to home", callback_data: "home" });
  });

  it("resolves the configured operations group before runtime and fallback targets", () => {
    expect(resolveNotificationChatId("-100123", "-200456", "-300789")).toBe(-100123);
    expect(resolveNotificationChatId(undefined, "-200456", "-300789")).toBe(-200456);
    expect(resolveNotificationChatId(undefined, undefined, "-300789")).toBe(-300789);
    expect(resolveNotificationChatId("not-a-chat", undefined, "0")).toBeNull();
  });

  it("consumes one digital item per requested quantity and preserves remaining lines", () => {
    expect(consumeDigitalInventory("link-a\\nuser:pass\\nlink-c", 2)).toEqual({ ok: true, items: ["link-a", "user:pass"], remaining: ["link-c"] });
    expect(consumeDigitalInventory("only-one", 2).ok).toBe(false);
  });

  it("recognizes optional product images without treating blank values as images", () => {
    expect(hasProductImage("https://cdn.example.com/gemini.png")).toBe(true);
    expect(hasProductImage("  ")).toBe(false);
    expect(hasProductImage(undefined)).toBe(false);
    expect(isHttpProductImageUrl("https://cdn.example.com/gemini.png")).toBe(true);
    expect(isHttpProductImageUrl("telegram-file-id")).toBe(false);
  });

  it("renders copy-friendly automatic delivery, manual delivery, warranty, and payment cancellation", () => {
    const automatic = formatPurchaseConfirmation(42, "Gemini", 100, { mode: "automatic", items: ["activation-link"], warrantyDays: 30 });
    expect(automatic).toContain("<blockquote>activation-link</blockquote>");
    expect(automatic).toContain("30 days");
    expect(formatPurchaseConfirmation(43, "Gemini", 100, { mode: "manual", warrantyDays: 7 })).toContain("Manual delivery");
    expect(formatPurchaseConfirmation(44, "Gemini", 100, { mode: "automatic", warrantyDays: "30 Minutes" })).toContain("30 Minutes");
    expect(formatPurchaseConfirmation(45, "Gemini", 100, { mode: "automatic", warrantyDays: "no warranty" })).toContain("no warranty");
    expect(isShopEligibleProduct({ active: 1, shopEligible: 1 })).toBe(true);
    expect(isShopEligibleProduct({ active: 1, shopEligible: 0 })).toBe(false);
    expect(isShopEligibleProduct({ active: 1 })).toBe(true);
    expect(buildPurchasePaymentFailureKeyboard(7).inline_keyboard[0][0]).toMatchObject({ text: "✖️ Cancel", callback_data: "buycancel:7" });
  });

  it("keeps core messages emoji-led and HTML formatted", () => {
    const home = formatHomeMessage({ firstName: "Rashid", username: "rashid", tier: "Silver", balanceCents: 1000, totalSpentCents: 2750, referrals: 3, access: true });
    expect(home).toContain("👋 <b>Welcome to ToolsMania, Rashid!</b>");
    expect(home).toContain("<code>@rashid</code>");
    expect(home).toContain("<b>Silver</b>");
    expect(home).toContain("<b>$10.00</b>");
    expect(home).toContain("Total spent: <b>$27.50</b>");
    expect(home).toContain("<b>3</b>");
    const order = formatDetailedOrder({ id: 42, kind: "purchase", status: "fulfilled", amountCents: 100, productName: "Gemini Pro", deliveredItem: "activation-link", paymentMethod: "Wallet", createdAt: "2026-08-17T12:34:56.000Z" });
    expect(order).toContain("Product: <b>Gemini Pro</b>");
    expect(order).toContain("Payment: <b>Wallet</b>");
    expect(order).toContain("Purchased: <b>2026-08-17 12:34 UTC</b>");
    expect(order).toContain("<pre>activation-link</pre>");
    expect(home).toContain("✅ Membership active");
    expect(formatMembershipMessage()).toContain("🔐 <b>Membership required</b>");
    expect(formatSupportPrompt()).toContain("🆘 <b>Support</b>");
    expect(formatSupportPrompt()).toContain("next message");
    expect(formatSupportPrompt()).not.toContain("/support your message");
    expect(formatSupportSubmitted("42")).toContain("✅ <b>Support request received</b>");
    expect(resolveConfiguredAdminChatId({ legacy: "7729451498" })).toBe(7729451498);
    expect(resolveConfiguredAdminChatId({ legacy: "" })).toBeNull();
    expect(diagnoseConfiguredAdminChatId({ legacy: "7729451498" })).toMatchObject({ source: "explicit", rawPresent: true, rawLength: 10, trimmedLength: 10, masked: "77••••98", valid: true, reason: "valid positive private chat ID" });
    expect(diagnoseConfiguredAdminChatId({ legacy: "-7729451498" }).reason).toContain("digits only");
    expect(diagnoseConfiguredAdminChatId({ legacy: "" }).reason).toContain("blank");
    expect(formatExtraDeviceMessage()).toContain("📱 <b>Extra device request</b>");
    expect(formatPurchaseConfirmation(42, "Premium", 100)).toContain("✅ <b>Order completed</b>");
    expect(formatOrderStatus(42, "purchase", "fulfilled", 100)).toContain("✅ #42 · purchase · fulfilled");
  });

  it("formats a compact paginated Shop instead of a message per product", () => {
    expect(SHOP_PAGE_SIZE).toBe(6);
    expect(formatShopSummary(0, 2)).toContain("📄 Page 1 of 2");
    expect(formatShopSummary(1, 2)).toContain("🛍️ <b>ToolsMania Shop</b>");
  });

  it("keeps all requested group notifications anonymous", () => {
    const freebie = formatFreebieClaimNotification("Gemini <Pro>", "Rashid", 12345);
    const reward = formatReferralRewardNotification("Canva", 2, "Rashid", 12345);
    const referral = formatQualifiedReferralNotification("Rashid", 12345, "Aisha", 67890);
    for (const message of [freebie, reward, referral]) {
      expect(message).not.toContain("12345");
      expect(message).not.toContain("67890");
      expect(message).toMatch(/\*{3,}/);
    }
    expect(freebie).toContain("Freebie claimed");
    expect(reward).toContain("Referral reward redeemed");
    expect(referral).toContain("New qualified referral");
  });
  it("renders a product announcement with stock, price, and Buy now action", () => {
    const message = formatProductAvailabilityAnnouncement({ name: "Gemini <Pro>", description: "Activation link", priceCents: 99, stock: 4 }, "new_stock");
    expect(message).toContain("📦 <b>New stock added</b>");
    expect(message).toContain("Gemini Pro");
    expect(message).toContain("$0.99");
    expect(message).toContain("📦 Stock: <b>4</b> available");
    expect(buildProductKeyboard(42).inline_keyboard.flat().some(button => button.text === "🛒 Buy now" && button.callback_data === "buyqty:42:0")).toBe(true);
  });

  it("renders Freebies as one compact message with grouped claim controls", () => {
    const message = formatFreebiesMessage([
      { name: "Gemini Pro Trial Link", stock: 40 },
      { name: "Notion Plus Coupon", stock: 10 },
    ]);
    expect(message).toContain("🎁 <b>ToolsMania Freebies</b>");
    expect(message).toContain("Gemini Pro Trial Link");
    expect(message).toContain("Notion Plus Coupon");
    expect(message.split("ToolsMania Freebies")).toHaveLength(2);

    const rows = buildFreebiesKeyboard([
      { id: 2, name: "Gemini Pro Trial Link" },
      { id: 6, name: "Notion Plus Coupon" },
    ]).inline_keyboard;
    expect(rows[0]).toHaveLength(2);
    expect(rows[0][0]).toMatchObject({ callback_data: "claim:2", style: "success" });
    expect(rows[0][1]).toMatchObject({ callback_data: "claim:6", style: "success" });
    expect(rows[1][0]).toMatchObject({ callback_data: "home", style: "primary" });
  });

  it("extracts payment-intent IDs from both SQLite insert result shapes", () => {
    expect(extractInsertedRowId([{ insertId: 17 }])).toBe(17);
    expect(extractInsertedRowId([{ lastInsertRowid: 18 }])).toBe(18);
    expect(extractInsertedRowId({ rows: [], lastInsertRowid: 19 })).toBe(19);
    expect(extractInsertedRowId({ rows: [], lastInsertRowid: 0 })).toBe(0);
  });

  it("awards referral credit only when the referral insert actually changes a row", () => {
    expect(didInsertReferralRow({ changes: 1, lastInsertRowid: 19 })).toBe(true);
    expect(didInsertReferralRow({ changes: 0, lastInsertRowid: 19 })).toBe(false);
    expect(didInsertReferralRow([{ insertId: 20 }])).toBe(true);
    expect(didInsertReferralRow([{ insertId: 0 }])).toBe(false);
  });

  it("routes every inline callback action deterministically", async () => {
    expect(parseTelegramCallbackAction("home")).toEqual({ kind: "home" });
    expect(parseTelegramCallbackAction("freebies")).toEqual({ kind: "freebies" });
    expect(parseTelegramCallbackAction("wallet")).toEqual({ kind: "wallet" });
    expect(parseTelegramCallbackAction("orders")).toEqual({ kind: "orders" });
    expect(parseTelegramCallbackAction("profile")).toEqual({ kind: "profile" });
    expect(parseTelegramCallbackAction("support")).toEqual({ kind: "support" });
    expect(parseTelegramCallbackAction("verify_membership")).toEqual({ kind: "verify_membership" });
    expect(parseTelegramCallbackAction("shop")).toEqual({ kind: "shop", id: 0 });
    expect(parseTelegramCallbackAction("shop:2")).toEqual({ kind: "shop", id: 2 });
    expect(parseTelegramCallbackAction("product:7")).toEqual({ kind: "product", id: 7 });
    expect(parseTelegramCallbackAction("claim:7")).toEqual({ kind: "claim", id: 7 });
    expect(parseTelegramCallbackAction("reward:7")).toEqual({ kind: "reward", id: 7 });
    expect(parseTelegramCallbackAction("buy:7")).toEqual({ kind: "buy", id: 7 });
    expect(parseTelegramCallbackAction("buyqty:7:3")).toEqual({ kind: "buyqty", id: 7, quantity: 3 });
    expect(parseTelegramCallbackAction("buyconfirm:7:3")).toEqual({ kind: "buyconfirm", id: 7, quantity: 3 });
    expect(parseTelegramCallbackAction("buycancel:7")).toEqual({ kind: "buycancel", id: 7 });
    expect(parseTelegramCallbackAction("customqty:7")).toEqual({ kind: "customqty", id: 7 });
    expect(parseTelegramCallbackAction("pricealert:7")).toEqual({ kind: "pricealert", id: 7 });
    expect(parseTelegramCallbackAction("walletamount:1000")).toEqual({ kind: "walletamount", amountCents: 1000 });
    expect(parseTelegramCallbackAction("admin_tickets")).toEqual({ kind: "admin_tickets" });
    expect(parseTelegramCallbackAction("admin_broadcast_help")).toEqual({ kind: "admin_broadcast_help" });
    expect(parseTelegramCallbackAction("admin_settings")).toEqual({ kind: "admin_settings" });
    expect(parseTelegramCallbackAction("admin_diagnostics")).toEqual({ kind: "admin_diagnostics" });
    expect(parseTelegramCallbackAction("admin_delete_help")).toEqual({ kind: "admin_delete_help" });
    expect(parseTelegramCallbackAction("unknown:7")).toBeNull();
    expect(parseTelegramCallbackAction("product:nope")).toBeNull();
  });

  it("routes the quantity purchase state machine through the real callback dispatcher seam", () => {
    expect(resolvePurchaseCallbackRoute({ kind: "buy", id: 7 })).toBe("quantity_prompt");
    expect(resolvePurchaseCallbackRoute({ kind: "buyqty", id: 7, quantity: 0 })).toBe("quantity_prompt");
    expect(resolvePurchaseCallbackRoute({ kind: "buyqty", id: 7, quantity: 3 })).toBe("purchase_review");
    expect(resolvePurchaseCallbackRoute({ kind: "buyconfirm", id: 7, quantity: 3 })).toBe("payment_method");
    expect(resolvePurchaseCallbackRoute({ kind: "paywallet", id: 7, quantity: 3 })).toBe("purchase_confirm");
    expect(resolvePurchaseCallbackRoute({ kind: "paybinance", id: 7, quantity: 3 })).toBe("binance_pay_pending");
    expect(parseTelegramCallbackAction("paystars:7:3")).toEqual({ kind: "paystars", id: 7, quantity: 3 });
    expect(resolvePurchaseCallbackRoute({ kind: "paystars", id: 7, quantity: 3 })).toBe("telegram_stars_pending");
    expect(resolvePurchaseCallbackRoute({ kind: "buycancel", id: 7 })).toBe("product_view");
    expect(resolvePurchaseCallbackRoute({ kind: "customqty", id: 7 })).toBe("custom_quantity");
    expect(resolvePurchaseCallbackRoute({ kind: "pricealert", id: 7 })).toBe("price_alert");
    expect(resolvePurchaseCallbackRoute({ kind: "walletamount", amountCents: 1000 })).toBe("wallet_amount");
    expect(parseTelegramCallbackAction("walletstars")).toEqual({ kind: "walletstars" });
    expect(parseTelegramCallbackAction("walletstars_pay")).toEqual({ kind: "walletstars_pay" });
    expect(resolvePurchaseCallbackRoute({ kind: "home" })).toBeNull();
    expect(resolvePurchaseCallbackRoute({ kind: "reward", id: 7 })).toBeNull();
  });

  it("uses the requested Stars conversion and renders public Bot Info stats", () => {
    expect(usdCentsToTelegramStars(120)).toBe(100);
    expect(usdCentsToTelegramStars(1000)).toBe(834);
    expect(usdCentsToTelegramStars(299)).toBe(250);
    expect(formatBotInfoMessage(45, 7)).toContain("Total bot users: <b>45</b>");
    expect(formatBotInfoMessage(45, 7)).toContain("Total completed orders: <b>7</b>");
  });

  it("renders the Qamify-style quantity and confirmation steps", () => {
    expect(formatQuantityPrompt("Gemini Pro", 299, 25)).toContain("🛒 <b>Choose quantity</b>");
    expect(formatQuantityPrompt("Gemini Pro", 299, 25)).toContain("📦 Available: <b>25</b>");
    expect(formatCustomQuantityPrompt("Gemini Pro", 25)).toContain("Reply with a whole number from <b>1</b> to <b>10</b>");
    expect(parseCustomQuantityInput("abc", 25)).toEqual({ ok: false, reason: "invalid" });
    expect(parseCustomQuantityInput("26", 25)).toEqual({ ok: false, reason: "range" });
    expect(parseCustomQuantityInput("3", 25)).toEqual({ ok: true, quantity: 3 });
    expect(resolveCustomQuantityReply("abc", "Gemini Pro", 25)).toMatchObject({ kind: "retry", reason: "invalid" });
    expect(resolveCustomQuantityReply("4", "Gemini Pro", 25)).toEqual({ kind: "review", quantity: 4 });
    expect(resolvePriceAlertToggle(null)).toBe(true);
    expect(resolvePriceAlertToggle(true)).toBe(false);
    expect(resolvePriceAlertToggle(false)).toBe(true);
    expect(formatPriceAlertMessage("Gemini Pro", true)).toContain("Price alert enabled");
    expect(formatPriceAlertMessage("Gemini Pro", false)).toContain("Price alert disabled");
    const quantityRows = buildQuantityKeyboard(7, 25).inline_keyboard;
    expect(quantityRows[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "1×", callback_data: "buyqty:7:1" }),
      expect.objectContaining({ text: "2×", callback_data: "buyqty:7:2" }),
      expect.objectContaining({ text: "3×", callback_data: "buyqty:7:3" }),
    ]));
    expect(quantityRows.at(-2)?.[0]).toMatchObject({ text: "✏️ Custom quantity", callback_data: "customqty:7", style: "primary" });
    expect(quantityRows.at(-1)?.[0]).toMatchObject({ text: "↩️ Back to product", callback_data: "product:7" });
    expect(formatPurchaseReview("Gemini Pro", 299, 3, 1000)).toContain("💰 Total to pay: <b>$8.97</b>");
    expect(formatPurchaseReview("Gemini Pro", 299, 3, 1000)).toContain("Choose a payment method");
    const reviewRows = buildPaymentMethodKeyboard(7, 3).inline_keyboard;
    expect(reviewRows[0][0]).toMatchObject({ text: "💳 Pay with Wallet", callback_data: "paywallet:7:3", style: "success" });
    expect(reviewRows[1][0]).toMatchObject({ text: "🟡 Pay with Binance Pay (USDT)", callback_data: "paybinance:7:3", style: "primary" });
    expect(reviewRows[2][0]).toMatchObject({ text: "🟢 Pay with USDT (BEP20)", callback_data: "paybep20:7:3", style: "primary" });
    expect(reviewRows[3][0]).toMatchObject({ text: "⭐ Pay with Telegram Stars", callback_data: "paystars:7:3", style: "primary" });
    expect(reviewRows[4][0]).toMatchObject({ callback_data: "buycancel:7" });
    expect(reviewRows[4][0]).not.toHaveProperty("style");
    process.env.BEP20 = "0xbep20-test";
    const payPrompt = formatBinancePayPurchasePrompt("Gemini Pro Trial Link", 1, 99);
    expect(payPrompt).toContain("Amount to send:</b> $0.99 USDT");
    expect(payPrompt).toContain("Binance Pay ID");
    const bep20Prompt = formatBep20PurchasePrompt("Gemini Pro Trial Link", 1, 99);
    expect(bep20Prompt).toContain("BEP20 network only");
    expect(bep20Prompt).toContain("Transaction Hash (TxID)");
    expect(bep20Prompt).toContain("Create this invoice before sending any funds");
    expect(bep20Prompt).toContain("This invoice expires in <b>30 minutes</b>");
    expect(payPrompt).not.toContain("USDT or USDC");
    expect(payPrompt).not.toContain("force_reply");
    expect(bep20Prompt).toContain("Deposit address (BEP20):</b> <code>0xbep20-test</code>");
    expect(formatBinancePayTopupPrompt(1000)).toContain("$10.00 USDT");
    expect(formatBep20TopupPrompt(1000)).toContain("<code>0xbep20-test</code>");
    expect(formatTelegramStarsTopupPrompt(120, 100)).toContain("100 Telegram Stars");
    expect(buildTelegramStarsTopupKeyboard().inline_keyboard[0][0]).toMatchObject({ text: "⭐ Pay with Telegram Stars", callback_data: "walletstars_pay" });
    const walletRows = buildWalletKeyboard().inline_keyboard;
    expect(walletRows[0][0]).toMatchObject({ callback_data: "walletadd" });
    expect(walletRows[1][0]).toMatchObject({ callback_data: "walletbep20" });
    expect(walletRows[2][0]).toMatchObject({ callback_data: "walletstars" });
    expect(walletRows[3][0]).toMatchObject({ callback_data: "home" });
    const depositRows = buildWalletDepositAmountKeyboard().inline_keyboard;
    expect(depositRows).toEqual([[expect.objectContaining({ callback_data: "walletcancel" })]]);
  });

  it("parses administrator payment-option settings with aliases and keeps Stars last", () => {
    expect([...parsePaymentOptionsList("wallet,binance,bep20,stars")]).toEqual(["wallet", "binance_pay", "bep20", "telegram_stars"]);
    expect([...parsePaymentOptionsList("all")]).toEqual(["wallet", "binance_pay", "bep20", "telegram_stars"]);
  });

  it("keeps all payment methods visible while labeling configured-disabled methods unavailable", () => {
    const previous = process.env.ENABLED_PAYMENT_OPTIONS;
    try {
      process.env.ENABLED_PAYMENT_OPTIONS = "wallet,binance_pay,bep20,telegram_stars";
      expect([...enabledPaymentOptions()]).toEqual(["wallet", "binance_pay", "bep20", "telegram_stars"]);
      expect(isPaymentOptionEnabled("telegram_stars")).toBe(true);
      expect(buildPaymentMethodKeyboard(7, 3).inline_keyboard[3][0]).toMatchObject({ text: "⭐ Pay with Telegram Stars", callback_data: "paystars:7:3" });

      process.env.ENABLED_PAYMENT_OPTIONS = "wallet,binance_pay";
      const purchaseRows = buildPaymentMethodKeyboard(7, 3).inline_keyboard;
      expect(purchaseRows).toHaveLength(5);
      expect(purchaseRows[0][0].text).toBe("💳 Pay with Wallet");
      expect(purchaseRows[2][0].text).toContain("USDT (BEP20)");
      expect(purchaseRows[2][0].text).toContain("unavailable");
      expect(purchaseRows[3][0].text).toContain("Telegram Stars");
      expect(purchaseRows[3][0].text).toContain("unavailable");

      const walletRows = buildWalletKeyboard().inline_keyboard;
      expect(walletRows[0][0].text).toBe("➕ Add funds with Binance Pay (USDT)");
      expect(walletRows[1][0].text).toContain("unavailable");
      expect(walletRows[2][0].text).toContain("unavailable");
      expect(paymentOptionForCallback(parseTelegramCallbackAction("walletstars")!)).toBe("telegram_stars");
      expect(paymentOptionForCallback(parseTelegramCallbackAction("paybep20:7:3")!)).toBe("bep20");
      expect(formatPaymentUnavailableMessage("telegram_stars")).toContain("temporarily unavailable");
    } finally {
      if (previous === undefined) delete process.env.ENABLED_PAYMENT_OPTIONS;
      else process.env.ENABLED_PAYMENT_OPTIONS = previous;
    }
  });

  it("parses administrator replies with numeric ticket IDs and bot command mentions", () => {
    expect(parseAdminReplyCommand("/reply 42 We are checking this now")).toEqual({ ticketId: 42, response: "We are checking this now" });
    expect(parseAdminReplyCommand("/reply@Toolsmania_bot #42  Please wait a moment. ")).toEqual({ ticketId: 42, response: "Please wait a moment." });
    expect(parseAdminReplyCommand("/reply 42")).toBeNull();
    expect(parseAdminReplyCommand("/reply ticket hello")).toBeNull();
  });

  it("keeps Bot Statistics on the administrator keyboard instead of the normal-user menu", () => {
    const adminRows = buildAdminKeyboard().inline_keyboard;
    expect(adminRows.flat().some((button) => button.callback_data === "admin_stats")).toBe(true);
    expect(adminRows.flat().some((button) => ["shop", "wallet", "orders", "profile", "freebies", "support"].includes(button.callback_data ?? ""))).toBe(false);
  });

  it("keeps BEP20 invoice expiry at 30 minutes and Binance Pay at 20 minutes", () => {
    expect(BEP20_PURCHASE_WINDOW_MS).toBe(30 * 60 * 1000);
    expect(BINANCE_PAY_PURCHASE_WINDOW_MS).toBe(20 * 60 * 1000);
  });

  it("parses free-form USD deposit amounts and rejects invalid ranges", () => {
    expect(parseUsdAmountInput("10")).toEqual({ ok: true, amountCents: 1000 });
    expect(parseUsdAmountInput("$10.50")).toEqual({ ok: true, amountCents: 1050 });
    expect(parseUsdAmountInput("0.01")).toEqual({ ok: true, amountCents: 1 });
    expect(parseUsdAmountInput("0.50")).toEqual({ ok: true, amountCents: 50 });
    expect(parseUsdAmountInput("1000")).toEqual({ ok: true, amountCents: 100000 });
    expect(parseUsdAmountInput("1000.01")).toMatchObject({ ok: false, reason: "range" });
    expect(parseUsdAmountInput("0")).toMatchObject({ ok: false, reason: "range" });
    expect(parseUsdAmountInput("ten")).toMatchObject({ ok: false, reason: "invalid" });
    expect(formatWalletDepositAmountPrompt("range")).toContain("$0.01</b> to <b>$1,000.00");
  });

  it("renders distinct USDT Binance Pay and BEP20 top-up invoices with copy and cancel controls", () => {
    process.env.BID = "configured-binance-pay-id";
    process.env.BEP20 = "configured-bep20-address";
    expect(formatBinancePayTopupPrompt(1050)).toContain("<code>configured-binance-pay-id</code>");
    expect(formatBinancePayTopupPrompt(1050)).toContain("Send the exact amount shown in USDT");
    expect(formatBep20TopupPrompt(1050)).toContain("<code>configured-bep20-address</code>");
    expect(formatBep20TopupPrompt(1050)).toContain("BEP20 network only");
    expect(formatBep20TopupPrompt(1050)).toContain("This invoice expires in <b>20 minutes</b>");
    expect(buildWalletDepositAmountKeyboard().inline_keyboard[0][0]).toMatchObject({ text: "✖️ Cancel", callback_data: "walletcancel" });
    expect(buildWalletDepositInvoiceKeyboard("binance_pay").inline_keyboard[0][0]).toMatchObject({ copy_text: { text: "configured-binance-pay-id" } });
    expect(buildWalletDepositInvoiceKeyboard("bep20").inline_keyboard[0][0]).toMatchObject({ copy_text: { text: "configured-bep20-address" } });
    expect(buildWalletDepositInvoiceKeyboard("bep20").inline_keyboard[1][0]).toMatchObject({ text: "✖️ Cancel", callback_data: "walletcancel" });
    expect(parseTelegramCallbackAction("walletbep20")).toEqual({ kind: "walletbep20" });
    expect(parseTelegramCallbackAction("paybep20:7:2")).toEqual({ kind: "paybep20", id: 7, quantity: 2 });
  });

  it("uses the configured payment destination for wallet and product payment instructions", () => {
    process.env.BID = "configured-binance-pay-id";
    process.env.BEP20 = "configured-bep20-address";
    expect(formatBinancePayPurchasePrompt("Test product", 1, 99)).toContain("configured-binance-pay-id");
    expect(formatBep20PurchasePrompt("Test product", 1, 99)).toContain("configured-bep20-address");
    expect(formatBinancePayTopupPrompt(500)).toContain("configured-binance-pay-id");
    expect(formatBep20TopupPrompt(500)).toContain("configured-bep20-address");
  });

  it("uses edit-in-place responses for callback navigation and send responses for commands", () => {
    expect(telegramResponseMethod()).toBe("sendMessage");
    expect(telegramResponseMethod(1234)).toBe("editMessageText");
    expect(telegramResponseMethod(1234, true)).toBe("sendMessage");
  });

  it("falls back from a rejected edit to one send with the same content", async () => {
    const previousToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(input).includes("/editMessageText")) return new Response(JSON.stringify({ ok: false, description: "message cannot be edited" }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), { status: 200 });
    });
    const markup = { inline_keyboard: [[{ text: "Next", callback_data: "shop:1" }]] };
    await respond(123, "🛍️ Shop", markup, 88);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/editMessageText");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/sendMessage");
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(secondBody).toMatchObject({ chat_id: 123, text: "🛍️ Shop", reply_markup: markup });
    fetchMock.mockRestore();
    if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousToken;
  });

  it("falls back to a fresh text message for photo or caption-only callback messages", async () => {
    const previousToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), { status: 200 }));
    rememberNonTextCallbackMessage({ message_id: 88, chat: { id: 123, type: "private" }, caption: "product", photo: [{ file_id: "photo" }] });
    await respond(123, "🛍️ Shop", { inline_keyboard: [[{ text: "Home", callback_data: "home" }]] }, 88);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/sendMessage");
    fetchMock.mockRestore();
    if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousToken;
  });

  it("does not send a duplicate when Telegram says the edit is already applied", async () => {
    const previousToken = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: false, description: "Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message" }), { status: 200 }));
    await respond(123, "🛍️ Shop", { inline_keyboard: [] }, 188);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/editMessageText");
    fetchMock.mockRestore();
    if (previousToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousToken;
  });

  it("assigns Telegram primary and success styles to representative keyboards", () => {
    const home = buildHomeKeyboard().inline_keyboard;
    expect(home[0][0]).toMatchObject({ callback_data: "freebies", style: "success" });
    expect(home[0][1]).toMatchObject({ callback_data: "shop", style: "primary" });
    expect(home[2][0]).toMatchObject({ text: "👤 Profile", callback_data: "profile" });
    expect(home[2][1]).toMatchObject({ text: "🤝 Referrals", callback_data: "referrals" });
    expect(home[2][0].callback_data).not.toBe(home[2][1].callback_data);
    expect(parseTelegramCallbackAction("referrals")).toEqual({ kind: "referrals" });

    const compactShop = buildShopKeyboard([{ id: 1, name: "Sample", priceCents: 100, stock: 3 }, { id: 2, name: "Sold out", priceCents: 100, stock: 0 }], 0, 1).inline_keyboard;
    expect(compactShop[0][0]).toMatchObject({ callback_data: "product:1", style: "success" });
    expect(compactShop[1][0]).toMatchObject({ callback_data: "product:2", style: "danger", text: expect.stringContaining("OUT OF STOCK") });
    expect(compactShop.at(-1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "🔄 Refresh", callback_data: "shop:0", style: "primary" }),
      expect.objectContaining({ text: "🏠 Back to home", callback_data: "home", style: "primary" }),
    ]));

    const compactProduct = buildProductKeyboard(1).inline_keyboard;
    expect(compactProduct[1]).toEqual([expect.objectContaining({ text: "🔔 Set price alert", callback_data: "pricealert:1" })]);
    expect(compactProduct[2]).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "↩️ Back to shop", callback_data: "shop", style: "primary" }),
      expect.objectContaining({ text: "🏠 Home", callback_data: "home" }),
    ]));

    const membership = buildMembershipKeyboard("https://t.me/+channel", "https://t.me/+group").inline_keyboard;
    expect(membership[0][0]).toMatchObject({ url: "https://t.me/+channel", style: "success" });
    expect(membership[2][0]).toMatchObject({ callback_data: "verify_membership", style: "primary" });

    const shop = buildShopKeyboard([{ id: 7, name: "Gemini Pro", priceCents: 1, stock: 1 }], 0, 2).inline_keyboard;
    expect(shop[0][0]).toMatchObject({ callback_data: "product:7", style: "success" });
    expect(shop[1][0]).toMatchObject({ callback_data: "shop:1", style: "primary" });

    const product = buildProductKeyboard(7).inline_keyboard;
    expect(product[0][0]).toMatchObject({ callback_data: "buyqty:7:0" });
    expect(product[2][0]).toMatchObject({ text: "↩️ Back to shop", callback_data: "shop", style: "primary" });
  });

  it("computes an automatically fulfilled wallet purchase without dashboard intervention", () => {
    expect(buildAutoPurchaseResult(1000, 299, 25)).toMatchObject({ ok: true, status: "fulfilled", quantity: 1, totalCents: 299, nextBalanceCents: 701, nextStock: 24 });
    expect(buildAutoPurchaseResult(1000, 299, 25, 3)).toMatchObject({ ok: true, status: "fulfilled", quantity: 3, totalCents: 897, nextBalanceCents: 103, nextStock: 22 });
    expect(buildAutoPurchaseResult(100, 299, 25, 3).status).toBe("insufficient_balance");
    expect(buildAutoPurchaseResult(1000, 299, 2, 3).status).toBe("out_of_stock");
    expect(buildConfirmedPurchasePlan(1000, 299, 25, 3)).toEqual({ ok: true, quantity: 3, totalCents: 897, nextBalanceCents: 103, nextStock: 22 });
    expect(buildConfirmedPurchasePlan(100, 299, 25, 3)).toEqual({ ok: false, status: "insufficient_balance", totalCents: 897 });
    expect(buildConfirmedPurchasePlan(1000, 299, 2, 3)).toEqual({ ok: false, status: "out_of_stock", totalCents: 897 });
  });

  it("keeps the administrator menu isolated from normal-user features", () => {
    const previous = process.env.TELEGRAM_ADMIN_CHAT_ID;
    process.env.TELEGRAM_ADMIN_CHAT_ID = "990321391";
    const adminKeyboard = buildAdminKeyboard().inline_keyboard;
    expect(adminKeyboard.flat().map((button) => button.callback_data)).toEqual(["admin_stats", "admin_tickets", "admin_broadcast_help", "admin_settings", "admin_diagnostics", "admin_delete_help"]);
    expect(adminKeyboard.flat().some((button) => button.web_app || button.url)).toBe(false);
    expect(adminKeyboard.flat().some((button) => ["shop", "wallet", "orders", "profile", "support", "home"].includes(button.callback_data ?? ""))).toBe(false);
    expect(formatAdminHomeMessage()).toContain("Admin Control Center");
    expect(isAuthorizedAdminMessage({ chat: { id: 990321391, type: "private" }, from: { id: 990321391 } })).toBe(true);
    expect(isAuthorizedAdminMessage({ chat: { id: 990321391, type: "group" }, from: { id: 990321391 } })).toBe(false);
    expect(isAuthorizedAdminMessage({ chat: { id: 990321391, type: "private" }, from: { id: 123 } })).toBe(false);
    if (previous === undefined) delete process.env.TELEGRAM_ADMIN_CHAT_ID;
    else process.env.TELEGRAM_ADMIN_CHAT_ID = previous;
  });

  it("builds a group completion notice without requiring a customer DM", () => {
    const withCustomer = buildFulfillmentNotifications(42, 100, 7278358063);
    expect(withCustomer.customer).toBeNull();
    expect(withCustomer.group).toContain("✅ <b>Order completed</b>");

    const withoutCustomer = buildFulfillmentNotifications(42, 100);
    expect(withoutCustomer.customer).toBeNull();
    expect(withoutCustomer.group).toContain("✅ <b>Order completed</b>");
  });

  it("builds a Qamify-style masked purchase announcement with a product deep link", () => {
    expect(maskPurchaseName("Rashid")).toBe("R*****");
    expect(productEmoji("Gemini Pro Trial Link")).toBe("🔋");
    const announcement = buildPurchaseAnnouncement(12, "Gemini Pro Trial Link", 2, "Rashid", 7278358063);
    expect(announcement.text).toContain("R*****");
    expect(announcement.text).not.toContain("R*****d");
    expect(announcement.text).toContain("2×");
    expect(announcement.text).toContain("🔋 <b>Gemini Pro Trial Link</b>");
    expect(announcement.replyMarkup.inline_keyboard[0][0]).toEqual({
      text: "🛍️ View product in bot",
      url: "https://t.me/Toolsmania_bot?start=product_12",
      style: "primary",
    });
  });
});

import type { Request, Response } from "express";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { getDb } from "./db";
import { binancePayDeposits, botSettings, botUsers, freeClaims, notificationDeliveries, orders, paymentIntents, priceAlerts, products, referrals, supportTickets, walletLedger } from "../drizzle/schema";
import { findBinancePayTransaction } from "./binancePay";
import { canClaimFreeItem, freeWindowStart, hasAccess, referralCodeForTelegramId, tierForReferralCount } from "../shared/botLogic";

type TelegramUser = { id: number; username?: string; first_name?: string; last_name?: string };
type TelegramChat = { id: number; type: string };
type TelegramMessage = { message_id: number; from?: TelegramUser; chat: TelegramChat; text?: string; reply_to_message?: TelegramMessage };
type TelegramCallbackQuery = { id: string; from: TelegramUser; message?: TelegramMessage; data?: string };
type TelegramUpdate = { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery };

const TELEGRAM_API = "https://api.telegram.org/bot";
const DEFAULT_CHANNEL_ID = process.env.TELEGRAM_MEMBERSHIP_CHANNEL_ID ?? "-1004462190741";
const DEFAULT_GROUP_ID = process.env.TELEGRAM_MEMBERSHIP_GROUP_ID ?? "-5036785892";
const DEFAULT_CHANNEL_URL = process.env.TELEGRAM_CHANNEL_JOIN_URL ?? "https://t.me/+hwT_8FtgDU85Mzlk";
const DEFAULT_GROUP_URL = process.env.TELEGRAM_GROUP_JOIN_URL ?? "https://t.me/+4I-HIdE73NIyMzI8";
const recentRequests = new Map<number, number>();
const pendingCustomQuantities = new Map<number, { productId: number; expiresAt: number }>();
const pendingBinancePayTopups = new Map<number, { expiresAt: number }>();
const pendingBinancePayPurchases = new Map<number, { intentId: number; expiresAt: number }>();

/** Testing-mode bootstrap credit; remove or disable before real-money launch. */
export const TESTING_WALLET_CREDIT_CENTS = 1000;
export const TESTING_WALLET_CREDIT_REFERENCE = "testing-wallet-credit-v1";

export const DEFAULT_TESTING_PRODUCTS = [
  { name: "ChatGPT Starter Access", description: "Testing catalog item for guided account access delivery.", priceCents: 299, stock: 25, active: 1, freeEligible: 0, freeWindowMs: null },
  { name: "Gemini Pro Trial Link", description: "Limited testing coupon/link item with automatic delivery.", priceCents: 99, stock: 40, active: 1, freeEligible: 1, freeWindowMs: 86400000 },
  { name: "Surfshark Trial Coupon", description: "Testing coupon/link item. Delivery details are provided after fulfillment.", priceCents: 100, stock: 20, active: 1, freeEligible: 0, freeWindowMs: null },
  { name: "Canva Creator Access", description: "Testing digital-service item for the Nebula Nook catalog.", priceCents: 250, stock: 15, active: 1, freeEligible: 0, freeWindowMs: null },
  { name: "CapCut Premium Trial", description: "Testing digital-service item with limited stock.", priceCents: 220, stock: 12, active: 1, freeEligible: 0, freeWindowMs: null },
  { name: "Notion Plus Coupon", description: "Testing productivity-service coupon with automatic delivery.", priceCents: 200, stock: 10, active: 1, freeEligible: 0, freeWindowMs: null },
] as const;

async function telegramCall<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch(`${TELEGRAM_API}${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(json.description ?? `Telegram ${method} failed`);
  return json.result as T;
}

async function sendMessage(chatId: number, text: string, replyMarkup?: unknown) {
  return telegramCall("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", reply_markup: replyMarkup });
}

async function editMessage(chatId: number, messageId: number, text: string, replyMarkup?: unknown) {
  return telegramCall("editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", reply_markup: replyMarkup });
}

export function telegramResponseMethod(messageId?: number, editFailed = false) {
  return messageId === undefined || editFailed ? "sendMessage" as const : "editMessageText" as const;
}

export async function respond(chatId: number, text: string, replyMarkup?: unknown, messageId?: number) {
  if (telegramResponseMethod(messageId) === "sendMessage") return sendMessage(chatId, text, replyMarkup);
  try {
    return await editMessage(chatId, messageId as number, text, replyMarkup);
  } catch (error) {
    console.error("[Telegram] editMessageText failed; falling back to one sendMessage", error);
    return sendMessage(chatId, text, replyMarkup);
  }
}

export async function sendTelegramMessage(chatId: number, text: string) {
  return sendMessage(chatId, text);
}

export function resolveNotificationChatId(configuredTarget: string | undefined, runtimeTarget: string | undefined, fallback: string) {
  const value = configuredTarget ?? runtimeTarget ?? fallback;
  const chatId = Number(value);
  return Number.isSafeInteger(chatId) && chatId !== 0 ? chatId : null;
}

export function buildAutoPurchaseResult(balanceCents: number, priceCents: number, stock: number, quantity = 1) {
  const safeQuantity = Math.max(1, Math.floor(quantity));
  const totalCents = priceCents * safeQuantity;
  if (balanceCents < totalCents) return { ok: false as const, status: "insufficient_balance" as const, quantity: safeQuantity, totalCents };
  if (stock < safeQuantity) return { ok: false as const, status: "out_of_stock" as const, quantity: safeQuantity, totalCents };
  return { ok: true as const, status: "fulfilled" as const, quantity: safeQuantity, totalCents, nextBalanceCents: balanceCents - totalCents, nextStock: stock - safeQuantity };
}

export function buildConfirmedPurchasePlan(balanceCents: number, priceCents: number, stock: number, quantity: number) {
  const purchase = buildAutoPurchaseResult(balanceCents, priceCents, stock, Math.max(1, Math.min(10, Math.floor(quantity))));
  if (!purchase.ok) return { ok: false as const, status: purchase.status, totalCents: purchase.totalCents };
  return { ok: true as const, quantity: purchase.quantity, totalCents: purchase.totalCents, nextBalanceCents: purchase.nextBalanceCents, nextStock: purchase.nextStock };
}

export function formatHomeMessage(details?: { firstName?: string | null; username?: string | null; tier?: string | null; balanceCents?: number; referrals?: number; access?: boolean }) {
  const name = (details?.firstName ?? "there").replace(/[<&>]/g, "");
  const handle = details?.username ? `@${details.username.replace(/[<&>]/g, "")}` : "No username";
  const tier = details?.tier ?? "Bronze";
  const balance = `$${((details?.balanceCents ?? 0) / 100).toFixed(2)}`;
  const referrals = details?.referrals ?? 0;
  const access = details?.access === false ? "🔒 Membership required" : "✅ Membership active";
  return `👋 <b>Welcome to Nebula Nook, ${name}!</b>\n\n👤 <b>Your account</b>\n├ Username: <code>${handle}</code>\n├ Tier: <b>${tier}</b>\n├ Wallet: <b>${balance}</b>\n└ Referrals: <b>${referrals}</b>\n\n${access}\nChoose an option below to claim freebies, shop digital products, or manage your account:`;
}

export function formatMembershipMessage() {
  return "🔐 <b>Membership required</b>\n\nJoin both Nebula Nook spaces below, then tap <b>✅ I have joined</b> to unlock the bot.";
}

export function formatSupportPrompt() {
  return "🆘 <b>Support</b>\n\nSend your request like this:\n<code>/support your message</code>";
}

export function formatSupportSubmitted(ticketId: string) {
  return `✅ <b>Support request received</b>\n\nTicket: <b>#${ticketId}</b>\nOur team will review it shortly.`;
}

export function formatPurchaseConfirmation(orderId: string | number, productName: string, amountCents: number) {
  return `✅ <b>Order completed</b>\n\n📦 Order: <b>#${orderId}</b>\n🛍️ Product: <b>${productName}</b>\n💵 Amount: <b>$${(amountCents / 100).toFixed(2)}</b>\n\n⚡ Payment received and your order is complete.`;
}

export const SHOP_PAGE_SIZE = 6;

export function formatShopSummary(page: number, pageCount: number) {
  return `🛍️ <b>Nebula Nook Shop</b>\n\nChoose a product to view its details and buy instantly.\n\n📄 Page ${page + 1} of ${pageCount}`;
}

export function formatFreebiesMessage(items: Array<{ name: string; stock: number }>) {
  const lines = items.map((item) => `🎁 <b>${item.name.replace(/[<&>]/g, "")}</b> · 📦 ${item.stock}`);
  return `🎁 <b>Nebula Nook Freebies</b>\n\nClaim one available item during its active window.\n\n${lines.join("\n")}`;
}

export function buildFreebiesKeyboard(items: Array<{ id: number; name: string }>) {
  const rows: TelegramButton[][] = [];
  for (let index = 0; index < items.length; index += 2) {
    rows.push(items.slice(index, index + 2).map((item) => ({ text: `🎁 ${item.name}`.slice(0, 64), callback_data: `claim:${item.id}`, style: "success" as const })));
  }
  rows.push([{ text: "↩️ Back to menu", callback_data: "home", style: "primary" }]);
  return keyboard(rows);
}

export function formatOrderStatus(orderId: string | number, kind: string, status: string, amountCents: number) {
  const icon = status === "fulfilled" ? "✅" : status === "cancelled" ? "❌" : "⏳";
  return `${icon} #${orderId} · ${kind} · ${status} · $${(amountCents / 100).toFixed(2)}`;
}

export function maskPurchaseName(name: string | undefined, telegramUserId?: number) {
  const raw = (name ?? "User").replace(/[<>]/g, "").trim() || "User";
  if (raw.length <= 2) return `${raw[0] ?? "U"}***`;
  return `${raw[0]}*****${raw.slice(-1)}`;
}

export function productEmoji(productName: string) {
  const value = productName.toLowerCase();
  if (value.includes("chatgpt") || value.includes("gemini") || value.includes("ai")) return "🔋";
  if (value.includes("surfshark") || value.includes("vpn")) return "🛡️";
  if (value.includes("canva") || value.includes("capcut")) return "🎨";
  if (value.includes("notion")) return "📝";
  return "🎁";
}

export function buildPurchaseAnnouncement(productId: string | number, productName: string, quantity: number, buyerName?: string, telegramUserId?: number) {
  const maskedName = maskPurchaseName(buyerName, telegramUserId);
  const botUrl = `https://t.me/NebulaNook4827_bot?start=product_${productId}`;
  return {
    text: `🛍️ <b>Nebula Nook</b>\n\n👤 <b>${maskedName}</b> just bought <b>${quantity}×</b> ${productEmoji(productName)} <b>${productName.replace(/[<>]/g, "")}</b>!`,
    replyMarkup: { inline_keyboard: [[{ text: "🛍️ View product in bot", url: botUrl, style: "primary" }]] },
  };
}

export function buildFulfillmentNotifications(orderId: string | number, amountCents: number, customerTelegramUserId?: number) {
  return {
    customer: null,
    group: `✅ <b>Order completed</b>\n\n📦 Order: <b>#${orderId}</b>${customerTelegramUserId ? `\n👤 User ID: <code>${customerTelegramUserId}</code>` : ""}\n💵 Amount: <b>$${(amountCents / 100).toFixed(2)}</b>`,
  };
}

export function formatExtraDeviceMessage() {
  return "📱 <b>Extra device request</b>\n\nPlease contact support with your request:\n<code>/support extra device request</code>";
}

export async function notifyAdmin(eventType: string, referenceId: string, text: string, replyMarkup?: unknown) {
  const db = await getDb();
  if (!db) return;
  const gate = await runtimeGate();
  const configuredTarget = process.env.TELEGRAM_ORDER_NOTIFICATION_CHAT_ID;
  const targetChatId = resolveNotificationChatId(configuredTarget, gate.notificationChatId, gate.groupId);
  if (targetChatId === null) return;
  await db.insert(notificationDeliveries).values({ adminChatId: targetChatId, eventType, referenceId, status: "queued" }).onDuplicateKeyUpdate({ set: { status: "queued" } });
  try {
    await sendMessage(targetChatId, text, replyMarkup);
    await db.update(notificationDeliveries).set({ status: "sent", sentAt: new Date() }).where(and(eq(notificationDeliveries.eventType, eventType), eq(notificationDeliveries.referenceId, referenceId)));
  } catch (error) {
    await db.update(notificationDeliveries).set({ status: "failed", error: error instanceof Error ? error.message : "notification failed" }).where(and(eq(notificationDeliveries.eventType, eventType), eq(notificationDeliveries.referenceId, referenceId)));
  }
}

async function answerCallback(id: string, text?: string) {
  await telegramCall("answerCallbackQuery", { callback_query_id: id, text, show_alert: false });
}

type TelegramButton = { text: string; callback_data?: string; url?: string; style?: "danger" | "success" | "primary" };

function keyboard(rows: Array<Array<TelegramButton>>) {
  return { inline_keyboard: rows };
}

export function buildHomeKeyboard() {
  return keyboard([
    [{ text: "🎁 Freebies", callback_data: "freebies", style: "success" }, { text: "🛍️ Shop", callback_data: "shop", style: "primary" }],
    [{ text: "💳 Wallet", callback_data: "wallet", style: "primary" }, { text: "📦 Orders", callback_data: "orders", style: "primary" }],
    [{ text: "👤 Profile", callback_data: "profile", style: "primary" }, { text: "🤝 Referrals", callback_data: "profile", style: "primary" }],
    [{ text: "🆘 Support", callback_data: "support", style: "primary" }],
  ]);
}

export function buildMembershipKeyboard(channelUrl: string, groupUrl: string) {
  return keyboard([
    [{ text: "📣 Join Updates Channel", url: channelUrl, style: "success" }],
    [{ text: "👥 Join Community Group", url: groupUrl, style: "success" }],
    [{ text: "✅ I have joined", callback_data: "verify_membership", style: "primary" }],
  ]);
}

export function buildShopKeyboard(items: Array<{ id: number; name: string; priceCents: number }>, page: number, pageCount: number) {
  const rows: TelegramButton[][] = items.map((item) => [{ text: `✨ ${item.name} · $${(item.priceCents / 100).toFixed(2)}`, callback_data: `product:${item.id}`, style: "primary" }]);
  const nav: TelegramButton[] = [];
  if (page > 0) nav.push({ text: "◀️ Previous", callback_data: `shop:${page - 1}`, style: "primary" });
  if (page < pageCount - 1) nav.push({ text: "Next ▶️", callback_data: `shop:${page + 1}`, style: "primary" });
  if (nav.length) rows.push(nav);
  rows.push([{ text: "🔄 Refresh", callback_data: `shop:${page}`, style: "primary" }, { text: "🏠 Back to home", callback_data: "home", style: "primary" }]);
  return keyboard(rows);
}

export function buildWalletKeyboard() {
  return keyboard([
    [{ text: "➕ Add funds with Binance Pay", callback_data: "walletadd", style: "success" }],
    [{ text: "🏠 Back to home", callback_data: "home", style: "primary" }],
  ]);
}

export function buildProductKeyboard(productId: number) {
  return keyboard([
    [{ text: "🛒 Buy now", callback_data: `buyqty:${productId}:0` }],
    [{ text: "🔔 Set price alert", callback_data: `pricealert:${productId}` }],
    [{ text: "↩️ Back to shop", callback_data: "shop", style: "primary" }, { text: "🏠 Home", callback_data: "home" }],
  ]);
}

export function buildQuantityKeyboard(productId: number, stock: number) {
  const max = Math.min(Math.max(stock, 0), 10);
  const choices = [1, 2, 3, 4, 5, 10].filter((quantity) => quantity <= max);
  const rows: TelegramButton[][] = [];
  for (let index = 0; index < choices.length; index += 3) {
    rows.push(choices.slice(index, index + 3).map((quantity) => ({ text: `${quantity}×`, callback_data: `buyqty:${productId}:${quantity}` })));
  }
  rows.push([{ text: "✏️ Custom quantity", callback_data: `customqty:${productId}`, style: "primary" }]);
  rows.push([{ text: "↩️ Back to product", callback_data: `product:${productId}` }]);
  return keyboard(rows);
}

export function buildPaymentMethodKeyboard(productId: number, quantity: number) {
  return keyboard([
    [{ text: "💳 Pay with Wallet", callback_data: `paywallet:${productId}:${quantity}`, style: "success" }],
    [{ text: "🟡 Pay with Binance Pay", callback_data: `paybinance:${productId}:${quantity}`, style: "primary" }],
    [{ text: "✖️ Cancel", callback_data: `buycancel:${productId}` }],
  ]);
}

export function buildUnavailableProductKeyboard() {
  return keyboard([
    [{ text: "🛍️ Open current Shop", callback_data: "shop:0", style: "primary" }],
    [{ text: "↩️ Back to home", callback_data: "home" }],
  ]);
}

export function formatQuantityPrompt(productName: string, priceCents: number, stock: number) {
  return `🛒 <b>Choose quantity</b>\n\n<b>${productName.replace(/[<&>]/g, "")}</b>\n💵 Unit price: <b>$${(priceCents / 100).toFixed(2)}</b>\n📦 Available: <b>${stock}</b>\n\nSelect a preset or choose <b>✏️ Custom quantity</b>:`;
}

export function formatCustomQuantityPrompt(productName: string, stock: number, error?: "invalid" | "range") {
  const notice = error === "invalid" ? "⚠️ Please reply with a whole number only.\n\n" : error === "range" ? `⚠️ Choose a quantity from 1 to ${Math.min(stock, 10)}.\n\n` : "";
  return `${notice}✏️ <b>Custom quantity</b>\n\n<b>${productName.replace(/[<&>]/g, "")}</b>\n📦 Available: <b>${stock}</b>\n\nReply with a whole number from <b>1</b> to <b>${Math.min(stock, 10)}</b>.`;
}

export function parseCustomQuantityInput(text: string, maxQuantity: number) {
  const value = text.trim();
  if (!/^\d+$/.test(value)) return { ok: false as const, reason: "invalid" as const };
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > Math.min(maxQuantity, 10)) return { ok: false as const, reason: "range" as const };
  return { ok: true as const, quantity };
}

export function formatPriceAlertMessage(productName: string, active: boolean) {
  return active
    ? `🔔 <b>Price alert enabled</b>\n\nYou’ll be notified when <b>${productName.replace(/[<&>]/g, "")}</b> changes price. Tap the alert button again to turn it off.`
    : `🔕 <b>Price alert disabled</b>\n\nYou will no longer receive price updates for <b>${productName.replace(/[<&>]/g, "")}</b>.`;
}

export function resolveCustomQuantityReply(text: string, productName: string, stock: number) {
  const parsed = parseCustomQuantityInput(text, stock);
  if (!parsed.ok) return { kind: "retry" as const, reason: parsed.reason, text: formatCustomQuantityPrompt(productName, stock, parsed.reason) };
  return { kind: "review" as const, quantity: parsed.quantity };
}

export function resolvePriceAlertToggle(existingActive: boolean | null) {
  return existingActive === null || !existingActive;
}

export function formatPurchaseReview(productName: string, priceCents: number, quantity: number, balanceCents: number) {
  const totalCents = priceCents * quantity;
  return `🧾 <b>Review your purchase</b>\n\n📦 <b>${productName.replace(/[<&>]/g, "")}</b>\n🔢 Quantity: <b>${quantity}</b>\n💵 Unit price: <b>$${(priceCents / 100).toFixed(2)}</b>\n💰 Total to pay: <b>$${(totalCents / 100).toFixed(2)}</b>\n\nWallet balance: <b>$${(balanceCents / 100).toFixed(2)}</b>\n\nChoose a payment method below. Your order is not completed until the selected payment is verified.`;
}

async function runtimeGate() {
  const db = await getDb();
  if (!db) return { channelId: DEFAULT_CHANNEL_ID, groupId: DEFAULT_GROUP_ID, channelUrl: DEFAULT_CHANNEL_URL, groupUrl: DEFAULT_GROUP_URL };
  const rows = await db.select().from(botSettings).where(sql`\`key\` in ('membership_channel_id', 'membership_group_id', 'membership_channel_url', 'membership_group_url', 'notification_chat_id')`);
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    channelId: values.membership_channel_id || DEFAULT_CHANNEL_ID,
    groupId: values.membership_group_id || DEFAULT_GROUP_ID,
    channelUrl: values.membership_channel_url || DEFAULT_CHANNEL_URL,
    groupUrl: values.membership_group_url || DEFAULT_GROUP_URL,
    notificationChatId: values.notification_chat_id || DEFAULT_GROUP_ID,
  };
}

async function membershipStatus(userId: number) {
  const gate = await runtimeGate();
  const [channel, group] = await Promise.all([
    telegramCall<{ status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked" }>("getChatMember", { chat_id: gate.channelId, user_id: userId }),
    telegramCall<{ status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked" }>("getChatMember", { chat_id: gate.groupId, user_id: userId }),
  ]);
  return { channel: channel.status, group: group.status, access: hasAccess(channel.status, group.status) };
}

async function ensureBotUser(user: TelegramUser, referralCode?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const existing = await db.select().from(botUsers).where(eq(botUsers.telegramUserId, user.id)).limit(1);
  if (existing[0]) {
    await db.update(botUsers).set({ username: user.username ?? null, firstName: user.first_name ?? null, lastName: user.last_name ?? null }).where(eq(botUsers.id, existing[0].id));
    return existing[0];
  }
  let referredById: number | null = null;
  if (referralCode) {
    const referrer = await db.select().from(botUsers).where(eq(botUsers.referralCode, referralCode)).limit(1);
    referredById = referrer[0]?.id ?? null;
  }
  const referralCodeForUser = referralCodeForTelegramId(user.id);
  await db.insert(botUsers).values({ telegramUserId: user.id, username: user.username ?? null, firstName: user.first_name ?? null, lastName: user.last_name ?? null, referralCode: referralCodeForUser, referredById, balanceCents: TESTING_WALLET_CREDIT_CENTS });
  const created = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, user.id)).limit(1))[0];
  if (!created) throw new Error("Failed to create Telegram user");
  await db.insert(walletLedger).values({ botUserId: created.id, amountCents: TESTING_WALLET_CREDIT_CENTS, kind: "adjustment", referenceId: TESTING_WALLET_CREDIT_REFERENCE, note: "Testing-mode bootstrap wallet credit" });
  if (referredById) {
    await db.insert(referrals).values({ referrerId: referredById, referredUserId: created.id, bonusCents: 0 }).onDuplicateKeyUpdate({ set: { referredUserId: created.id } });
    const referralCount = await db.select({ count: sql<number>`count(*)` }).from(referrals).where(eq(referrals.referrerId, referredById));
    await db.update(botUsers).set({ tier: tierForReferralCount(Number(referralCount[0]?.count ?? 0)) }).where(eq(botUsers.id, referredById));
  }
  return created;
}

async function requireAccess(chatId: number, userId: number, messageId?: number) {
  const status = await membershipStatus(userId);
  if (status.access) return true;
  const gate = await runtimeGate();
  await respond(chatId, formatMembershipMessage(), buildMembershipKeyboard(gate.channelUrl, gate.groupUrl), messageId);
  return false;
}

async function showHome(chatId: number, userId: number, messageId?: number) {
  if (!(await requireAccess(chatId, userId, messageId))) return;
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const referralRows = await db.select({ count: sql<number>`count(*)` }).from(referrals).where(eq(referrals.referrerId, user?.id ?? -1));
  const status = await membershipStatus(userId);
  await respond(chatId, formatHomeMessage({
    firstName: user?.firstName,
    username: user?.username,
    tier: user?.tier,
    balanceCents: user?.balanceCents,
    referrals: Number(referralRows[0]?.count ?? 0),
    access: status.access,
  }), buildHomeKeyboard(), messageId);
}

export function isPurchasableProduct(product: { active: number | boolean; stock: number } | undefined) {
  return Boolean(product && (product.active === 1 || product.active === true) && product.stock > 0);
}

async function showFreebies(chatId: number, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const items = await db.select().from(products).where(and(eq(products.active, 1), eq(products.freeEligible, 1))).limit(20);
  if (!items.length) return respond(chatId, "🎁 <b>Nebula Nook Freebies</b>\n\nThere are no free items available right now. Check back soon!", buildFreebiesKeyboard([]), messageId);
  return respond(chatId, formatFreebiesMessage(items), buildFreebiesKeyboard(items), messageId);
}

async function showShop(chatId: number, page = 0, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const items = await db.select().from(products).where(and(eq(products.active, 1), gt(products.stock, 0))).limit(60);
  if (!items.length) return respond(chatId, "🛍️ <b>Shop</b>\n\nThe catalog is empty right now. Please check back soon.", undefined, messageId);
  const pageCount = Math.max(1, Math.ceil(items.length / SHOP_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);
  const pageItems = items.slice(safePage * SHOP_PAGE_SIZE, (safePage + 1) * SHOP_PAGE_SIZE);
  await respond(chatId, formatShopSummary(safePage, pageCount), buildShopKeyboard(pageItems, safePage, pageCount), messageId);
}

async function showProduct(chatId: number, productId: number, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const item = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!isPurchasableProduct(item)) return respond(chatId, "⚠️ This product is currently unavailable.\n\nThis may be an old product button. Open the current Shop to see items that are in stock.", buildUnavailableProductKeyboard(), messageId);
  const safeName = item.name.replace(/[<&>]/g, "");
  const safeDescription = item.description.replace(/[<&>]/g, "");
  await respond(chatId, `✨ <b>${safeName}</b>\n\n${safeDescription}\n\n━━━━━━━━━━━━━━\n💵 <b>$${(item.priceCents / 100).toFixed(2)}</b> per unit\n📦 <b>${item.stock}</b> available\n⚡ <b>Instant digital delivery</b>\n🛡️ <b>Quality checked</b>\n\nChoose an action below:`, buildProductKeyboard(item.id), messageId);
}

async function showWallet(chatId: number, userId: number, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const ledger = await db.select().from(walletLedger).where(eq(walletLedger.botUserId, user?.id ?? -1)).orderBy(desc(walletLedger.createdAt)).limit(1000);
  const history = ledger.length ? ledger.map((entry) => `${entry.amountCents >= 0 ? "+" : ""}$${(entry.amountCents / 100).toFixed(2)} — ${entry.kind}`).join("\n") : "No ledger activity yet.";
  await respond(chatId, `💳 <b>Wallet</b>\n\n💰 Balance: $${((user?.balanceCents ?? 0) / 100).toFixed(2)}\n\n📒 <b>Recent activity</b>\n${history}`, buildWalletKeyboard(), messageId);
}

async function showOrders(chatId: number, userId: number, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const rows = await db.select().from(orders).where(eq(orders.botUserId, user?.id ?? -1)).orderBy(desc(orders.createdAt)).limit(1000);
  await respond(chatId, rows.length ? `📦 <b>Orders</b>\n\n${rows.map((o) => formatOrderStatus(o.id, o.kind, o.status, o.amountCents)).join("\n")}` : "📦 <b>Orders</b>\n\nYou do not have any orders yet.", buildHomeKeyboard(), messageId);
}

async function showProfile(chatId: number, userId: number, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const referralsCount = await db.select({ count: sql<number>`count(*)` }).from(referrals).where(eq(referrals.referrerId, user?.id ?? -1));
  await respond(chatId, `👤 <b>Profile</b>\n\n🪪 Name: ${user?.firstName ?? "User"}\n🏅 Tier: ${user?.tier ?? "Bronze"}\n🤝 Referrals: ${Number(referralsCount[0]?.count ?? 0)}\n\n🔗 Your referral link:\nhttps://t.me/NebulaNook4827_bot?start=ref_${user?.referralCode ?? ""}`, buildHomeKeyboard(), messageId);
}

async function claimFree(chatId: number, userId: number, productId: number, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const product = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!user || !product || !product.freeEligible || !product.freeWindowMs || product.stock <= 0) return respond(chatId, "⚠️ This free item is currently unavailable.", buildFreebiesKeyboard([]), messageId);
  const now = Date.now();
  const windowStart = freeWindowStart(now, product.freeWindowMs);
  const last = await db.select().from(freeClaims).where(and(eq(freeClaims.botUserId, user.id), eq(freeClaims.productId, product.id))).orderBy(desc(freeClaims.createdAt)).limit(1);
  if (!canClaimFreeItem(last[0] ? Number(last[0].windowStartMs) : null, now, product.freeWindowMs)) return respond(chatId, "⏳ You have already claimed this item during the current free window.", buildFreebiesKeyboard([{ id: product.id, name: product.name }]), messageId);
  await db.insert(freeClaims).values({ botUserId: user.id, productId: product.id, windowStartMs: windowStart, status: "claimed" });
  await db.update(products).set({ stock: product.stock - 1 }).where(eq(products.id, product.id));
  const order = await db.insert(orders).values({ botUserId: user.id, productId: product.id, kind: "free", amountCents: 0, status: "fulfilled" });
  await respond(chatId, `✅ <b>Free claim recorded</b>\n\n🎁 ${product.name}\n\nYour claim has been added to your order history.`, buildHomeKeyboard(), messageId);
  await notifyAdmin("free_claim", `${user.id}:${product.id}:${windowStart}`, `<b>Free claim</b>\nUser: ${user.telegramUserId}\nProduct: ${product.name}`);
}

async function showQuantityPrompt(chatId: number, productId: number, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const product = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!isPurchasableProduct(product)) return respond(chatId, "⚠️ This product is currently unavailable.\n\nThis may be an old product button. Open the current Shop to see items that are in stock.", buildUnavailableProductKeyboard(), messageId);
  return respond(chatId, formatQuantityPrompt(product.name, product.priceCents, product.stock), buildQuantityKeyboard(product.id, product.stock), messageId);
}

async function showPurchaseReview(chatId: number, userId: number, productId: number, quantity: number, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const product = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  const safeQuantity = Math.max(1, Math.min(10, Math.floor(quantity)));
  if (!user || !isPurchasableProduct(product)) return respond(chatId, "⚠️ This product is currently unavailable.\n\nOpen the current Shop to choose an in-stock product.", buildUnavailableProductKeyboard(), messageId);
  if (product.stock < safeQuantity) return respond(chatId, `⚠️ Only <b>${product.stock}</b> unit${product.stock === 1 ? "" : "s"} remain. Choose a smaller quantity.`, buildQuantityKeyboard(product.id, product.stock), messageId);
  return respond(chatId, formatPurchaseReview(product.name, product.priceCents, safeQuantity, user.balanceCents), buildPaymentMethodKeyboard(productId, safeQuantity), messageId);
}

async function cancelPurchase(chatId: number, productId: number, messageId?: number) {
  return showProduct(chatId, productId, messageId);
}

async function createPurchase(chatId: number, userId: number, productId: number, quantity = 1, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const requestedQuantity = Math.max(1, Math.min(10, Math.floor(quantity)));
  const outcome = await db.transaction(async (tx) => {
    const user = (await tx.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
    const product = (await tx.select().from(products).where(eq(products.id, productId)).limit(1))[0];
    if (!user || !product || !product.active) return { ok: false as const, status: "unavailable" as const };
    const purchase = buildConfirmedPurchasePlan(user.balanceCents, product.priceCents, product.stock, requestedQuantity);
    if (!purchase.ok) return { ok: false as const, status: purchase.status, balanceCents: user.balanceCents, productId: product.id, stock: product.stock, totalCents: purchase.totalCents };
    const result = await tx.insert(orders).values({ botUserId: user.id, productId: product.id, kind: "purchase", amountCents: purchase.totalCents, status: "fulfilled" });
    const orderId = String(result[0]?.insertId ?? `${user.id}:${product.id}:${Date.now()}`);
    await tx.update(botUsers).set({ balanceCents: purchase.nextBalanceCents }).where(eq(botUsers.id, user.id));
    await tx.update(products).set({ stock: purchase.nextStock }).where(eq(products.id, product.id));
    await tx.insert(walletLedger).values({ botUserId: user.id, amountCents: -purchase.totalCents, kind: "purchase", referenceId: orderId, note: `Automatic purchase (${purchase.quantity}×): ${product.name}` });
    return { ok: true as const, orderId, productId: product.id, productName: product.name, quantity: purchase.quantity, totalCents: purchase.totalCents, buyerName: user.firstName ?? user.username ?? "User", telegramUserId: user.telegramUserId };
  });
  if (!outcome.ok) {
    if (outcome.status === "insufficient_balance") return respond(chatId, `💳 <b>Insufficient balance</b>\n\nYour balance is <b>$${(outcome.balanceCents / 100).toFixed(2)}</b>. This quantity costs <b>$${(outcome.totalCents / 100).toFixed(2)}.</b>`, buildQuantityKeyboard(outcome.productId, outcome.stock), messageId);
    if (outcome.status === "out_of_stock") return respond(chatId, "⚠️ The requested quantity is no longer available.", buildQuantityKeyboard(outcome.productId, outcome.stock), messageId);
    return respond(chatId, "⚠️ This product is currently unavailable.\n\nOpen the current Shop to choose an in-stock product.", buildUnavailableProductKeyboard(), messageId);
  }
  const announcement = buildPurchaseAnnouncement(outcome.productId, outcome.productName, outcome.quantity, outcome.buyerName, outcome.telegramUserId);
  await respond(chatId, formatPurchaseConfirmation(outcome.orderId, `${outcome.quantity}× ${outcome.productName}`, outcome.totalCents), buildHomeKeyboard(), messageId);
  await notifyAdmin("order_fulfilled", String(outcome.orderId), announcement.text, announcement.replyMarkup);
}

async function createBinancePayPurchaseIntent(chatId: number, userId: number, productId: number, quantity: number, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const product = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  const safeQuantity = Math.max(1, Math.min(10, Math.floor(quantity)));
  if (!user || !isPurchasableProduct(product)) return respond(chatId, "⚠️ This product is currently unavailable.\\n\\nOpen the current Shop to choose an in-stock product.", buildUnavailableProductKeyboard(), messageId);
  if (product.stock < safeQuantity) return respond(chatId, `⚠️ Only <b>${product.stock}</b> unit${product.stock === 1 ? "" : "s"} remain. Choose a smaller quantity.`, buildQuantityKeyboard(product.id, product.stock), messageId);
  const amountCents = product.priceCents * safeQuantity;
  const inserted = await db.insert(paymentIntents).values({ botUserId: user.id, productId: product.id, quantity: safeQuantity, amountCents, method: "binance_pay", status: "pending" });
  const intentId = Number(inserted[0]?.insertId ?? 0);
  if (!intentId) throw new Error("Failed to create Binance Pay payment intent");
  pendingBinancePayPurchases.set(userId, { intentId, expiresAt: Date.now() + 15 * 60 * 1000 });
  return respond(chatId, `🟡 <b>Pay with Binance Pay</b>\\n\\n📦 <b>${product.name.replace(/[<&>]/g, "")}</b>\\n🔢 Quantity: <b>${safeQuantity}</b>\\n💰 <b>Amount to pay: $${(amountCents / 100).toFixed(2)}</b>\\n\\nPay exactly <b>$${(amountCents / 100).toFixed(2)}</b> to the configured Binance Pay merchant account. After payment, reply to this message with the Binance Pay transaction/order ID.\\n\\nYour order will remain pending until the transaction is verified. No stock will be deducted before successful verification.`, { force_reply: true, selective: true }, messageId);
}

export type TelegramCallbackAction =
  | { kind: "verify_membership" | "home" | "freebies" | "wallet" | "walletadd" | "orders" | "profile" | "support" }
  | { kind: "shop" | "product" | "claim" | "buy" | "customqty" | "pricealert"; id: number }
  | { kind: "buyqty" | "buyconfirm" | "paywallet" | "paybinance"; id: number; quantity: number }
  | { kind: "buycancel"; id: number };

export function parseTelegramCallbackAction(data?: string): TelegramCallbackAction | null {
  const value = data ?? "";
  if (["verify_membership", "home", "freebies", "wallet", "walletadd", "orders", "profile", "support"].includes(value)) return { kind: value as TelegramCallbackAction["kind"] } as TelegramCallbackAction;
  const quantityMatch = value.match(/^(buyqty|buyconfirm|paywallet|paybinance):([0-9]+):([0-9]+)$/);
  if (quantityMatch) return { kind: quantityMatch[1] as "buyqty" | "buyconfirm" | "paywallet" | "paybinance", id: Number(quantityMatch[2]), quantity: Number(quantityMatch[3]) };
  const cancelMatch = value.match(/^buycancel:([0-9]+)$/);
  if (cancelMatch) return { kind: "buycancel", id: Number(cancelMatch[1]) };
  const match = value.match(/^(shop|product|claim|buy|customqty|pricealert)(?::(\d+))?$/);
  if (!match) return null;
  if (match[1] === "shop" && match[2] === undefined) return { kind: "shop", id: 0 };
  if (!match[2]) return null;
  return { kind: match[1] as "shop" | "product" | "claim" | "buy", id: Number(match[2]) };
}

export function resolvePurchaseCallbackRoute(action: TelegramCallbackAction) {
  if (action.kind === "buy") return "quantity_prompt" as const;
  if (action.kind === "buyqty") return action.quantity > 0 ? "purchase_review" as const : "quantity_prompt" as const;
  if (action.kind === "buyconfirm") return "payment_method" as const;
  if (action.kind === "paywallet") return "purchase_confirm" as const;
  if (action.kind === "paybinance") return "binance_pay_pending" as const;
  if (action.kind === "buycancel") return "product_view" as const;
  if (action.kind === "customqty") return "custom_quantity" as const;
  if (action.kind === "pricealert") return "price_alert" as const;
  return null;
}

export async function handleCallback(query: TelegramCallbackQuery, options: { skipAccess?: boolean } = {}) {
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  if (!chatId) return;
  const userId = query.from.id;
  await answerCallback(query.id);
  const action = parseTelegramCallbackAction(query.data);
  if (!action) return;
  if (action.kind === "verify_membership") return showHome(chatId, userId, messageId);
  if (!options.skipAccess && !(await requireAccess(chatId, userId, messageId))) return;
  if (action.kind === "home") return showHome(chatId, userId, messageId);
  if (action.kind === "freebies") return showFreebies(chatId, messageId);
  if (action.kind === "shop") return showShop(chatId, action.id, messageId);
  if (action.kind === "product") return showProduct(chatId, action.id, messageId);
  if (action.kind === "wallet") return showWallet(chatId, userId, messageId);
  if (action.kind === "walletadd") {
    pendingBinancePayTopups.set(userId, { expiresAt: Date.now() + 10 * 60 * 1000 });
    return respond(chatId, "💳 <b>Add funds with Binance Pay</b>\n\nSend the Binance Pay transaction ID after you have paid the merchant account. I will verify it server-side and credit the positive received amount in USDT, USDC, or BUSD.\n\n⚠️ Never send a password, API key, or secret here.", { force_reply: true, selective: true }, messageId);
  }
  if (action.kind === "orders") return showOrders(chatId, userId, messageId);
  if (action.kind === "profile") return showProfile(chatId, userId, messageId);
  if (action.kind === "support") return respond(chatId, formatSupportPrompt(), buildHomeKeyboard(), messageId);
  if (action.kind === "claim") return claimFree(chatId, userId, action.id, messageId);
  const purchaseRoute = resolvePurchaseCallbackRoute(action);
  if (purchaseRoute === "quantity_prompt" && (action.kind === "buy" || (action.kind === "buyqty" && action.quantity === 0))) return showQuantityPrompt(chatId, action.id, messageId);
  if (purchaseRoute === "purchase_review" && action.kind === "buyqty") return showPurchaseReview(chatId, userId, action.id, action.quantity, messageId);
  if (purchaseRoute === "payment_method" && action.kind === "buyconfirm") return showPurchaseReview(chatId, userId, action.id, action.quantity, messageId);
  if (purchaseRoute === "purchase_confirm" && action.kind === "paywallet") return createPurchase(chatId, userId, action.id, action.quantity, messageId);
  if (purchaseRoute === "binance_pay_pending" && action.kind === "paybinance") return createBinancePayPurchaseIntent(chatId, userId, action.id, action.quantity, messageId);
  if (purchaseRoute === "product_view" && action.kind === "buycancel") return cancelPurchase(chatId, action.id, messageId);
  if (purchaseRoute === "custom_quantity" && action.kind === "customqty") {
    const db = await getDb();
    if (!db) throw new Error("Database is unavailable");
    const product = (await db.select().from(products).where(eq(products.id, action.id)).limit(1))[0];
    if (!isPurchasableProduct(product)) return respond(chatId, "⚠️ This product is currently unavailable.", undefined, messageId);
    pendingCustomQuantities.set(userId, { productId: action.id, expiresAt: Date.now() + 5 * 60 * 1000 });
    return respond(chatId, formatCustomQuantityPrompt(product.name, product.stock), { force_reply: true, selective: true }, messageId);
  }
  if (purchaseRoute === "price_alert" && action.kind === "pricealert") {
    const db = await getDb();
    if (!db) throw new Error("Database is unavailable");
    const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
    const product = (await db.select().from(products).where(eq(products.id, action.id)).limit(1))[0];
    if (!user || !product) return respond(chatId, "⚠️ This product is currently unavailable.", undefined, messageId);
    const existing = (await db.select().from(priceAlerts).where(and(eq(priceAlerts.botUserId, user.id), eq(priceAlerts.productId, product.id))).limit(1))[0];
    const active = resolvePriceAlertToggle(existing ? existing.active === 1 : null);
    if (existing) {
      await db.update(priceAlerts).set({ active: active ? 1 : 0 }).where(eq(priceAlerts.id, existing.id));
    } else {
      await db.insert(priceAlerts).values({ botUserId: user.id, productId: product.id, active: 1 });
    }
    return respond(chatId, formatPriceAlertMessage(product.name, active), buildProductKeyboard(product.id), messageId);
  }
}

async function verifyAndFulfillBinancePurchase(chatId: number, userId: number, intentId: number, transactionId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const intent = (await db.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1))[0];
  if (!intent || intent.status !== "pending") { await respond(chatId, "ℹ️ This Binance Pay order is no longer pending. Open Shop to start a new purchase.", buildHomeKeyboard()); return false; }
  const result = await findBinancePayTransaction(transactionId, intent.amountCents);
  if (!result.ok) {
    const reason = result.reason === "invalid_id" ? "That does not look like a valid transaction/order ID." : result.reason === "not_found" ? "I could not find that Binance Pay payment yet." : result.reason === "amount_mismatch" ? `The payment amount does not match the required $${(intent.amountCents / 100).toFixed(2)}.` : result.reason === "unsupported_asset" ? "Only USDT, USDC, or BUSD payments can be verified." : "That payment is not a positive received transaction.";
    await respond(chatId, `❌ <b>Payment not verified</b>\n\n${reason}\n\nPlease send the correct Binance Pay transaction/order ID.`, { force_reply: true, selective: true });
    return false;
  }
  const transactionRef = result.transaction.transactionId ?? transactionId.trim();
  const outcome = await db.transaction(async (tx) => {
    const current = (await tx.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1))[0];
    if (!current || current.status !== "pending") return { ok: false as const, reason: "already_processed" as const };
    const reusedIntent = (await tx.select().from(paymentIntents).where(eq(paymentIntents.transactionId, transactionRef)).limit(1))[0];
    const reusedTopup = (await tx.select().from(binancePayDeposits).where(eq(binancePayDeposits.transactionId, transactionRef)).limit(1))[0];
    if (reusedIntent || reusedTopup) return { ok: false as const, reason: "already_used" as const };
    const account = (await tx.select().from(botUsers).where(eq(botUsers.id, current.botUserId)).limit(1))[0];
    const product = (await tx.select().from(products).where(eq(products.id, current.productId)).limit(1))[0];
    if (!account || account.id !== (await tx.select({ id: botUsers.id }).from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0]?.id) return { ok: false as const, reason: "user_mismatch" as const };
    if (!product || !isPurchasableProduct(product) || product.stock < current.quantity) return { ok: false as const, reason: "unavailable" as const };
    const inserted = await tx.insert(orders).values({ botUserId: account.id, productId: product.id, kind: "purchase", amountCents: current.amountCents, status: "fulfilled" });
    const orderId = Number(inserted[0]?.insertId ?? 0);
    await tx.update(products).set({ stock: sql`${products.stock} - ${current.quantity}` }).where(eq(products.id, product.id));
    await tx.update(paymentIntents).set({ status: "fulfilled", transactionId: transactionRef }).where(eq(paymentIntents.id, current.id));
    return { ok: true as const, orderId, product, quantity: current.quantity, amountCents: current.amountCents };
  });
  if (!outcome.ok) {
    const text = outcome.reason === "already_used" ? "ℹ️ This Binance Pay transaction was already used." : outcome.reason === "unavailable" ? "⚠️ The product sold out before payment verification. Contact support with your transaction ID." : outcome.reason === "user_mismatch" ? "⚠️ This payment intent belongs to a different account." : "ℹ️ This payment order was already processed.";
    await respond(chatId, text, buildHomeKeyboard());
    return false;
  }
  const buyer = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const announcement = buildPurchaseAnnouncement(outcome.product.id, outcome.product.name, outcome.quantity, buyer?.firstName ?? "User", userId);
  await respond(chatId, formatPurchaseConfirmation(outcome.orderId, `${outcome.quantity}× ${outcome.product.name}`, outcome.amountCents), buildHomeKeyboard());
  await notifyAdmin("order_fulfilled", String(outcome.orderId), announcement.text, announcement.replyMarkup);
  return true;
}

async function restorePendingBinancePurchase(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  if (!user) return null;
  const intent = (await db.select().from(paymentIntents).where(eq(paymentIntents.botUserId, user.id)).limit(20)).find((row) => row.status === "pending");
  if (!intent) return null;
  const pending = { intentId: intent.id, expiresAt: Date.now() + 15 * 60 * 1000 };
  pendingBinancePayPurchases.set(userId, pending);
  return pending;
}

export async function handleMessage(message: TelegramMessage) {
  const user = message.from;
  if (!user || !message.text) return;
  const messageText = message.text;
  const pendingPurchase = pendingBinancePayPurchases.get(user.id) ?? await restorePendingBinancePurchase(user.id);
  if (pendingPurchase) {
    if (pendingPurchase.expiresAt <= Date.now()) {
      pendingBinancePayPurchases.delete(user.id);
      return respond(message.chat.id, "⌛ <b>Binance Pay order expired</b>\n\nOpen Shop and start again.", buildHomeKeyboard());
    }
    const completed = await verifyAndFulfillBinancePurchase(message.chat.id, user.id, pendingPurchase.intentId, messageText);
    if (completed) pendingBinancePayPurchases.delete(user.id);
    return;
  }
  const pendingTopup = pendingBinancePayTopups.get(user.id);
  if (pendingTopup) {
    if (pendingTopup.expiresAt <= Date.now()) {
      pendingBinancePayTopups.delete(user.id);
      return respond(message.chat.id, "⌛ <b>Top-up prompt expired</b>\n\nOpen Wallet and tap Add funds with Binance Pay to try again.", buildWalletKeyboard());
    }
    pendingBinancePayTopups.delete(user.id);
    const result = await findBinancePayTransaction(messageText);
    if (!result.ok) {
      const reason = result.reason === "invalid_id" ? "That does not look like a valid transaction ID." : result.reason === "not_found" ? "I could not find that Binance Pay transaction yet." : result.reason === "unsupported_asset" ? "Only USDT, USDC, or BUSD receipts can be credited." : "That transaction is not a positive received payment.";
      return respond(message.chat.id, `❌ <b>Top-up not credited</b>\n\n${reason}\n\nCheck the ID and try again from Wallet.`, buildWalletKeyboard());
    }
    const db = await getDb();
    if (!db) throw new Error("Database is unavailable");
    const credited = await db.transaction(async (tx) => {
      const existing = (await tx.select().from(binancePayDeposits).where(eq(binancePayDeposits.transactionId, result.transaction.transactionId ?? messageText.trim())).limit(1))[0];
      if (existing) return { ok: false as const, reason: "already_credited" as const, amountCents: existing.amountCents, asset: existing.asset };
      const account = (await tx.select().from(botUsers).where(eq(botUsers.telegramUserId, user.id)).limit(1))[0];
      if (!account) return { ok: false as const, reason: "user_missing" as const };
      const transactionId = result.transaction.transactionId ?? messageText.trim();
      await tx.insert(binancePayDeposits).values({ botUserId: account.id, transactionId, amountCents: result.amountCents, asset: result.asset, rawStatus: result.transaction.status ?? null });
      await tx.update(botUsers).set({ balanceCents: account.balanceCents + result.amountCents }).where(eq(botUsers.id, account.id));
      await tx.insert(walletLedger).values({ botUserId: account.id, amountCents: result.amountCents, kind: "topup", referenceId: transactionId, note: `Binance Pay ${result.asset} transaction verified` });
      return { ok: true as const, amountCents: result.amountCents, asset: result.asset, transactionId };
    });
    if (!credited.ok && credited.reason === "already_credited") return respond(message.chat.id, `ℹ️ <b>Already credited</b>\n\nThis transaction was already added to a wallet for <b>$${(credited.amountCents / 100).toFixed(2)}</b>.`, buildWalletKeyboard());
    if (!credited.ok) return respond(message.chat.id, "⚠️ Your bot wallet could not be found. Send /start and try again.", buildHomeKeyboard());
    await notifyAdmin("wallet_topup", credited.transactionId, `💳 <b>Binance Pay wallet top-up</b>\n\n👤 User ID: <code>${user.id}</code>\n💰 Amount: <b>$${(credited.amountCents / 100).toFixed(2)} ${credited.asset}</b>\n🧾 Transaction: <code>${credited.transactionId}</code>`);
    return respond(message.chat.id, `✅ <b>Wallet credited</b>\n\n💰 Added: <b>$${(credited.amountCents / 100).toFixed(2)} ${credited.asset}</b>\n🧾 Transaction: <code>${credited.transactionId}</code>\n\nYour new balance is available in Wallet.`, buildWalletKeyboard());
  }
  const pending = pendingCustomQuantities.get(user.id);
  if (pending && pending.expiresAt > Date.now()) {
    const db = await getDb();
    if (!db) throw new Error("Database is unavailable");
    const product = (await db.select().from(products).where(eq(products.id, pending.productId)).limit(1))[0];
    if (!product || !product.active || product.stock <= 0) {
      pendingCustomQuantities.delete(user.id);
      return respond(message.chat.id, "⚠️ This product is currently unavailable.", undefined, message.reply_to_message?.message_id);
    }
    const reply = resolveCustomQuantityReply(message.text, product.name, product.stock);
    if (reply.kind === "retry") return respond(message.chat.id, reply.text, { force_reply: true, selective: true }, message.reply_to_message?.message_id);
    pendingCustomQuantities.delete(user.id);
    return showPurchaseReview(message.chat.id, user.id, pending.productId, reply.quantity, message.reply_to_message?.message_id);
  }
  if (pending && pending.expiresAt <= Date.now()) pendingCustomQuantities.delete(user.id);
  const [command, ...rest] = message.text.trim().split(/\s+/);
  const referral = rest.find((part) => part.startsWith("ref_"))?.slice(4);
  const productDeepLink = rest.find((part) => part.startsWith("product_"))?.slice(8);
  await ensureBotUser(user, referral);
  if (command === "/start") {
    if (productDeepLink && /^\d+$/.test(productDeepLink)) {
      if (!(await requireAccess(message.chat.id, user.id))) return;
      return showProduct(message.chat.id, Number(productDeepLink));
    }
    return showHome(message.chat.id, user.id);
  }
  if (!(await requireAccess(message.chat.id, user.id))) return;
  if (command === "/shop") return showShop(message.chat.id);
  if (command === "/wallet") return showWallet(message.chat.id, user.id);
  if (command === "/orders") return showOrders(message.chat.id, user.id);
  if (command === "/profile") return showProfile(message.chat.id, user.id);
  if (command === "/support") {
    const body = rest.filter((part) => !part.startsWith("ref_")).join(" ").trim();
    if (!body) return sendMessage(message.chat.id, formatSupportPrompt());
    const db = await getDb();
    if (!db) throw new Error("Database is unavailable");
    const botUser = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, user.id)).limit(1))[0];
    const ticketResult = await db.insert(supportTickets).values({ botUserId: botUser.id, message: body, status: "open" });
    const ticketId = String(ticketResult[0]?.insertId ?? `${user.id}:${Date.now()}`);
    await notifyAdmin("support", ticketId, `<b>New support ticket #${ticketId}</b>\nFrom: ${user.first_name ?? "User"} (${user.id})\n\n${body}`);
    return sendMessage(message.chat.id, formatSupportSubmitted(ticketId));
  }
  if (command === "/extra_device") return sendMessage(message.chat.id, formatExtraDeviceMessage());
  return showHome(message.chat.id, user.id);
}

export function validTelegramWebhookSecret(value: string | undefined) {
  return value && /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : undefined;
}

export function validTelegramJoinUrl(value: string) {
  return /^https:\/\/t\.me\/(?:\+[A-Za-z0-9_-]+|[A-Za-z0-9_]{5,})$/.test(value.trim());
}

export async function configureTelegramWebhook(webhookUrl: string) {
  if (!/^https:\/\//i.test(webhookUrl)) throw new Error("Webhook URL must use HTTPS");
  const secret = validTelegramWebhookSecret(process.env.TELEGRAM_WEBHOOK_SECRET);
  await telegramCall("setWebhook", { url: webhookUrl, ...(secret ? { secret_token: secret } : {}) });
  return telegramCall<{ url: string; has_custom_certificate: boolean; pending_update_count: number; last_error_message?: string }>("getWebhookInfo", {});
}

export async function telegramWebhookHealth(_req: Request, res: Response) {
  try {
    const info = await telegramCall<{ url: string; pending_update_count: number; last_error_message?: string }>("getWebhookInfo", {});
    return res.json({ ok: true, webhook: info });
  } catch (error) {
    return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Telegram unavailable" });
  }
}

export async function telegramWebhookHandler(req: Request, res: Response) {
  try {
    const configuredSecret = validTelegramWebhookSecret(process.env.TELEGRAM_WEBHOOK_SECRET);
    if (configuredSecret && req.header("x-telegram-bot-api-secret-token") !== configuredSecret) return res.status(401).json({ error: "invalid webhook secret" });
    const update = req.body as TelegramUpdate;
    if (!update || typeof update.update_id !== "number" || (!update.message && !update.callback_query)) return res.status(400).json({ ok: false, error: "invalid Telegram update" });
    const db = await getDb();
    if (db) {
      const last = (await db.select().from(botSettings).where(eq(botSettings.key, "last_update_id")).limit(1))[0];
      if (last && update.update_id <= Number(last.value)) return res.json({ ok: true, duplicate: true });
      await db.insert(botSettings).values({ key: "last_update_id", value: String(update.update_id) }).onDuplicateKeyUpdate({ set: { value: String(update.update_id) } });
    }
    const actorId = update.message?.from?.id ?? update.callback_query?.from.id;
    if (actorId) {
      const now = Date.now();
      const previous = recentRequests.get(actorId) ?? 0;
      if (now - previous < 350) return res.status(429).json({ ok: false, error: "rate limited" });
      recentRequests.set(actorId, now);
    }
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message) await handleMessage(update.message);
    return res.json({ ok: true });
  } catch (error) {
    console.error("[Telegram] webhook error", error);
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "unknown error" });
  }
}

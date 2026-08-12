import type { Request, Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { botSettings, botUsers, freeClaims, notificationDeliveries, orders, products, referrals, supportTickets, walletLedger } from "../drizzle/schema";
import { canClaimFreeItem, freeWindowStart, hasAccess, referralCodeForTelegramId, tierForReferralCount } from "../shared/botLogic";

type TelegramUser = { id: number; username?: string; first_name?: string; last_name?: string };
type TelegramChat = { id: number; type: string };
type TelegramMessage = { message_id: number; from?: TelegramUser; chat: TelegramChat; text?: string };
type TelegramCallbackQuery = { id: string; from: TelegramUser; message?: TelegramMessage; data?: string };
type TelegramUpdate = { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery };

const TELEGRAM_API = "https://api.telegram.org/bot";
const DEFAULT_CHANNEL_ID = process.env.TELEGRAM_MEMBERSHIP_CHANNEL_ID ?? "-1004462190741";
const DEFAULT_GROUP_ID = process.env.TELEGRAM_MEMBERSHIP_GROUP_ID ?? "-5036785892";
const DEFAULT_CHANNEL_URL = process.env.TELEGRAM_CHANNEL_JOIN_URL ?? "https://t.me/+hwT_8FtgDU85Mzlk";
const DEFAULT_GROUP_URL = process.env.TELEGRAM_GROUP_JOIN_URL ?? "https://t.me/+4I-HIdE73NIyMzI8";
const recentRequests = new Map<number, number>();

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

export async function sendTelegramMessage(chatId: number, text: string) {
  return sendMessage(chatId, text);
}

export function resolveNotificationChatId(configuredTarget: string | undefined, runtimeTarget: string | undefined, fallback: string) {
  const value = configuredTarget ?? runtimeTarget ?? fallback;
  const chatId = Number(value);
  return Number.isSafeInteger(chatId) && chatId !== 0 ? chatId : null;
}

export function buildAutoPurchaseResult(balanceCents: number, priceCents: number, stock: number) {
  if (balanceCents < priceCents) return { ok: false as const, status: "insufficient_balance" as const };
  if (stock <= 0) return { ok: false as const, status: "out_of_stock" as const };
  return { ok: true as const, status: "fulfilled" as const, nextBalanceCents: balanceCents - priceCents, nextStock: stock - 1 };
}

export function formatHomeMessage() {
  return "✨ <b>Welcome to Nebula Nook</b>\n\nYour hub for digital deals, freebies, referrals, and fast support. Choose an option below:";
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
    replyMarkup: { inline_keyboard: [[{ text: "🛍️ View product in bot", url: botUrl }]] },
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

function keyboard(rows: Array<Array<{ text: string; callback_data?: string; url?: string }>>) {
  return { inline_keyboard: rows };
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

async function requireAccess(chatId: number, userId: number) {
  const status = await membershipStatus(userId);
  if (status.access) return true;
  const gate = await runtimeGate();
  await sendMessage(chatId, formatMembershipMessage(), keyboard([
    [{ text: "📣 Join Updates Channel", url: gate.channelUrl }],
    [{ text: "👥 Join Community Group", url: gate.groupUrl }],
    [{ text: "✅ I have joined", callback_data: "verify_membership" }],
  ]));
  return false;
}

async function showHome(chatId: number, userId: number) {
  if (!(await requireAccess(chatId, userId))) return;
  await sendMessage(chatId, formatHomeMessage(), keyboard([
    [{ text: "🎁 Freebies", callback_data: "freebies" }, { text: "🛍️ Shop", callback_data: "shop" }],
    [{ text: "💳 Wallet", callback_data: "wallet" }, { text: "📦 Orders", callback_data: "orders" }],
    [{ text: "👤 Profile", callback_data: "profile" }, { text: "🆘 Support", callback_data: "support" }],
  ]));
}

async function showFreebies(chatId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const items = await db.select().from(products).where(and(eq(products.active, 1), eq(products.freeEligible, 1))).limit(20);
  if (!items.length) return sendMessage(chatId, "🎁 <b>Freebies</b>\n\nThere are no free items available right now. Check back soon!");
  await sendMessage(chatId, "🎁 <b>Freebies</b>\n\nClaim available items during their active window. One claim per window applies.");
  for (const item of items) {
    await sendMessage(chatId, `🎁 <b>${item.name}</b>\n${item.description}\n\n📦 Stock: ${item.stock}`, keyboard([[{ text: "🎁 Claim free", callback_data: `claim:${item.id}` }]]));
  }
}

async function showShop(chatId: number, page = 0) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const items = await db.select().from(products).where(eq(products.active, 1)).limit(60);
  if (!items.length) return sendMessage(chatId, "🛍️ <b>Shop</b>\n\nThe catalog is empty right now. Please check back soon.");
  const pageCount = Math.max(1, Math.ceil(items.length / SHOP_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);
  const pageItems = items.slice(safePage * SHOP_PAGE_SIZE, (safePage + 1) * SHOP_PAGE_SIZE);
  const rows = pageItems.map((item) => [{ text: `✨ ${item.name} · $${(item.priceCents / 100).toFixed(2)}`, callback_data: `product:${item.id}` }]);
  const nav: Array<{ text: string; callback_data: string }> = [];
  if (safePage > 0) nav.push({ text: "◀️ Previous", callback_data: `shop:${safePage - 1}` });
  if (safePage < pageCount - 1) nav.push({ text: "Next ▶️", callback_data: `shop:${safePage + 1}` });
  if (nav.length) rows.push(nav);
  await sendMessage(chatId, formatShopSummary(safePage, pageCount), keyboard(rows));
}

async function showProduct(chatId: number, productId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const item = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!item || !item.active || item.stock <= 0) return sendMessage(chatId, "⚠️ This product is currently unavailable.");
  await sendMessage(chatId, `✨ <b>${item.name}</b>\n\n${item.description}\n\n💵 Price: <b>$${(item.priceCents / 100).toFixed(2)}</b>\n📦 Stock: <b>${item.stock}</b>\n🚚 Delivery: <b>Automatic</b>`, keyboard([[{ text: "🛒 Buy now", callback_data: `buy:${item.id}` }], [{ text: "↩️ Back to shop", callback_data: "shop" }]]));
}

async function showWallet(chatId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const ledger = await db.select().from(walletLedger).where(eq(walletLedger.botUserId, user?.id ?? -1)).orderBy(desc(walletLedger.createdAt)).limit(1000);
  const history = ledger.length ? ledger.map((entry) => `${entry.amountCents >= 0 ? "+" : ""}$${(entry.amountCents / 100).toFixed(2)} — ${entry.kind}`).join("\n") : "No ledger activity yet.";
  await sendMessage(chatId, `💳 <b>Wallet</b>\n\n💰 Balance: $${((user?.balanceCents ?? 0) / 100).toFixed(2)}\n\n📒 <b>Recent activity</b>\n${history}`);
}

async function showOrders(chatId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const rows = await db.select().from(orders).where(eq(orders.botUserId, user?.id ?? -1)).orderBy(desc(orders.createdAt)).limit(1000);
  await sendMessage(chatId, rows.length ? `📦 <b>Orders</b>\n\n${rows.map((o) => formatOrderStatus(o.id, o.kind, o.status, o.amountCents)).join("\n")}` : "📦 <b>Orders</b>\n\nYou do not have any orders yet.");
}

async function showProfile(chatId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const referralsCount = await db.select({ count: sql<number>`count(*)` }).from(referrals).where(eq(referrals.referrerId, user?.id ?? -1));
  await sendMessage(chatId, `👤 <b>Profile</b>\n\n🪪 Name: ${user?.firstName ?? "User"}\n🏅 Tier: ${user?.tier ?? "Bronze"}\n🤝 Referrals: ${Number(referralsCount[0]?.count ?? 0)}\n\n🔗 Your referral link:\nhttps://t.me/NebulaNook4827_bot?start=ref_${user?.referralCode ?? ""}`);
}

async function claimFree(chatId: number, userId: number, productId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const product = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!user || !product || !product.freeEligible || !product.freeWindowMs || product.stock <= 0) return sendMessage(chatId, "⚠️ This free item is currently unavailable.");
  const now = Date.now();
  const windowStart = freeWindowStart(now, product.freeWindowMs);
  const last = await db.select().from(freeClaims).where(and(eq(freeClaims.botUserId, user.id), eq(freeClaims.productId, product.id))).orderBy(desc(freeClaims.createdAt)).limit(1);
  if (!canClaimFreeItem(last[0] ? Number(last[0].windowStartMs) : null, now, product.freeWindowMs)) return sendMessage(chatId, "⏳ You have already claimed this item during the current free window.");
  await db.insert(freeClaims).values({ botUserId: user.id, productId: product.id, windowStartMs: windowStart, status: "claimed" });
  await db.update(products).set({ stock: product.stock - 1 }).where(eq(products.id, product.id));
  const order = await db.insert(orders).values({ botUserId: user.id, productId: product.id, kind: "free", amountCents: 0, status: "fulfilled" });
  await sendMessage(chatId, `✅ <b>Free claim recorded</b>\n\n🎁 ${product.name}\n\nYour claim has been added to your order history.`);
  await notifyAdmin("free_claim", `${user.id}:${product.id}:${windowStart}`, `<b>Free claim</b>\nUser: ${user.telegramUserId}\nProduct: ${product.name}`);
}

async function createPurchase(chatId: number, userId: number, productId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const product = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!user || !product || !product.active) return sendMessage(chatId, "⚠️ This product is currently unavailable.");
  const purchase = buildAutoPurchaseResult(user.balanceCents, product.priceCents, product.stock);
  if (purchase.status === "insufficient_balance") return sendMessage(chatId, `💳 <b>Insufficient balance</b>\n\nYour balance is <b>$${(user.balanceCents / 100).toFixed(2)}</b>. This product costs <b>$${(product.priceCents / 100).toFixed(2)}</b>.`);
  if (purchase.status === "out_of_stock") return sendMessage(chatId, "⚠️ This product is currently unavailable.");
  const result = await db.insert(orders).values({ botUserId: user.id, productId: product.id, kind: "purchase", amountCents: product.priceCents, status: "fulfilled" });
  const orderId = String(result[0]?.insertId ?? `${user.id}:${product.id}:${Date.now()}`);
  await db.update(botUsers).set({ balanceCents: user.balanceCents - product.priceCents }).where(eq(botUsers.id, user.id));
  await db.update(products).set({ stock: product.stock - 1 }).where(eq(products.id, product.id));
  await db.insert(walletLedger).values({ botUserId: user.id, amountCents: -product.priceCents, kind: "purchase", referenceId: orderId, note: `Automatic purchase: ${product.name}` });
  const notifications = buildFulfillmentNotifications(orderId, product.priceCents, user.telegramUserId);
  const announcement = buildPurchaseAnnouncement(product.id, product.name, 1, user.firstName ?? user.username ?? "User", user.telegramUserId);
  await sendMessage(chatId, formatPurchaseConfirmation(orderId, product.name, product.priceCents));
  await notifyAdmin("order_fulfilled", orderId, announcement.text, announcement.replyMarkup);
}

async function handleCallback(query: TelegramCallbackQuery) {
  const chatId = query.message?.chat.id;
  if (!chatId) return;
  const userId = query.from.id;
  await answerCallback(query.id);
  const data = query.data ?? "";
  if (data === "verify_membership") return showHome(chatId, userId);
  if (!(await requireAccess(chatId, userId))) return;
  if (data === "freebies") return showFreebies(chatId);
  if (data === "shop") return showShop(chatId);
  if (data.startsWith("shop:")) return showShop(chatId, Number(data.slice(5)));
  if (data.startsWith("product:")) return showProduct(chatId, Number(data.slice(8)));
  if (data === "wallet") return showWallet(chatId, userId);
  if (data === "orders") return showOrders(chatId, userId);
  if (data === "profile") return showProfile(chatId, userId);
  if (data === "support") return sendMessage(chatId, formatSupportPrompt());
  if (data.startsWith("claim:")) return claimFree(chatId, userId, Number(data.slice(6)));
  if (data.startsWith("buy:")) return createPurchase(chatId, userId, Number(data.slice(4)));
}

async function handleMessage(message: TelegramMessage) {
  const user = message.from;
  if (!user || !message.text) return;
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

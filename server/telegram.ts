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
const DEFAULT_CHANNEL_URL = process.env.TELEGRAM_CHANNEL_JOIN_URL ?? "https://t.me/NebulaNookUpdates";
const DEFAULT_GROUP_URL = process.env.TELEGRAM_GROUP_JOIN_URL ?? "https://t.me/NebulaNookCommunity";
const recentRequests = new Map<number, number>();

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

async function notifyAdmin(eventType: string, referenceId: string, text: string) {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminChatId) return;
  const db = await getDb();
  if (!db) return;
  await db.insert(notificationDeliveries).values({ adminChatId: Number(adminChatId), eventType, referenceId, status: "queued" }).onDuplicateKeyUpdate({ set: { status: "queued" } });
  try {
    await sendMessage(Number(adminChatId), text);
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
  const rows = await db.select().from(botSettings).where(sql`key in ('membership_channel_id', 'membership_group_id', 'membership_channel_url', 'membership_group_url')`);
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    channelId: values.membership_channel_id || DEFAULT_CHANNEL_ID,
    groupId: values.membership_group_id || DEFAULT_GROUP_ID,
    channelUrl: values.membership_channel_url || DEFAULT_CHANNEL_URL,
    groupUrl: values.membership_group_url || DEFAULT_GROUP_URL,
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
  await db.insert(botUsers).values({ telegramUserId: user.id, username: user.username ?? null, firstName: user.first_name ?? null, lastName: user.last_name ?? null, referralCode: referralCodeForUser, referredById });
  const created = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, user.id)).limit(1))[0];
  if (!created) throw new Error("Failed to create Telegram user");
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
  await sendMessage(chatId, "Please join both membership spaces, then tap <b>I have joined</b>.", keyboard([
    [{ text: "Join Channel", url: gate.channelUrl }],
    [{ text: "Join Group", url: gate.groupUrl }],
    [{ text: "I have joined", callback_data: "verify_membership" }],
  ]));
  return false;
}

async function showHome(chatId: number, userId: number) {
  if (!(await requireAccess(chatId, userId))) return;
  await sendMessage(chatId, "<b>Nebula Nook</b>\nChoose an option below.", keyboard([
    [{ text: "Freebies", callback_data: "freebies" }, { text: "Shop", callback_data: "shop" }],
    [{ text: "Wallet", callback_data: "wallet" }, { text: "Orders", callback_data: "orders" }],
    [{ text: "Profile", callback_data: "profile" }, { text: "Support", callback_data: "support" }],
  ]));
}

async function showFreebies(chatId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const items = await db.select().from(products).where(and(eq(products.active, 1), eq(products.freeEligible, 1))).limit(20);
  if (!items.length) return sendMessage(chatId, "No freebies are configured yet.");
  await sendMessage(chatId, "<b>Freebies</b>\nEach item is claimable once per configured free window.");
  for (const item of items) {
    await sendMessage(chatId, `<b>${item.name}</b>\n${item.description}\nStock: ${item.stock}`, keyboard([[{ text: "Claim free", callback_data: `claim:${item.id}` }]]));
  }
}

async function showShop(chatId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const items = await db.select().from(products).where(eq(products.active, 1)).limit(30);
  if (!items.length) return sendMessage(chatId, "The shop is empty. Admins can add products from the dashboard.");
  await sendMessage(chatId, "<b>Shop</b>");
  for (const item of items) await sendMessage(chatId, `<b>${item.name}</b>\n${item.description}\nPrice: $${(item.priceCents / 100).toFixed(2)}\nStock: ${item.stock}`, keyboard([[{ text: "Buy", callback_data: `buy:${item.id}` }]]));
}

async function showWallet(chatId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const ledger = await db.select().from(walletLedger).where(eq(walletLedger.botUserId, user?.id ?? -1)).orderBy(desc(walletLedger.createdAt)).limit(1000);
  const history = ledger.length ? ledger.map((entry) => `${entry.amountCents >= 0 ? "+" : ""}$${(entry.amountCents / 100).toFixed(2)} — ${entry.kind}`).join("\n") : "No ledger activity yet.";
  await sendMessage(chatId, `<b>Wallet</b>\nBalance: $${((user?.balanceCents ?? 0) / 100).toFixed(2)}\n\n${history}`);
}

async function showOrders(chatId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const rows = await db.select().from(orders).where(eq(orders.botUserId, user?.id ?? -1)).orderBy(desc(orders.createdAt)).limit(1000);
  await sendMessage(chatId, rows.length ? `<b>Orders</b>\n${rows.map((o) => `#${o.id} ${o.kind} — ${o.status} — $${(o.amountCents / 100).toFixed(2)}`).join("\n")}` : "No orders yet.");
}

async function showProfile(chatId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const referralsCount = await db.select({ count: sql<number>`count(*)` }).from(referrals).where(eq(referrals.referrerId, user?.id ?? -1));
  await sendMessage(chatId, `<b>Profile</b>\nName: ${user?.firstName ?? "User"}\nTier: ${user?.tier ?? "Bronze"}\nReferrals: ${Number(referralsCount[0]?.count ?? 0)}\nReferral link: https://t.me/NebulaNook4827_bot?start=ref_${user?.referralCode ?? ""}`);
}

async function claimFree(chatId: number, userId: number, productId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const product = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!user || !product || !product.freeEligible || !product.freeWindowMs || product.stock <= 0) return sendMessage(chatId, "This free item is unavailable.");
  const now = Date.now();
  const windowStart = freeWindowStart(now, product.freeWindowMs);
  const last = await db.select().from(freeClaims).where(and(eq(freeClaims.botUserId, user.id), eq(freeClaims.productId, product.id))).orderBy(desc(freeClaims.createdAt)).limit(1);
  if (!canClaimFreeItem(last[0] ? Number(last[0].windowStartMs) : null, now, product.freeWindowMs)) return sendMessage(chatId, "You have already claimed this item during the current free window.");
  await db.insert(freeClaims).values({ botUserId: user.id, productId: product.id, windowStartMs: windowStart, status: "claimed" });
  await db.update(products).set({ stock: product.stock - 1 }).where(eq(products.id, product.id));
  const order = await db.insert(orders).values({ botUserId: user.id, productId: product.id, kind: "free", amountCents: 0, status: "fulfilled" });
  await sendMessage(chatId, `Free claim recorded for <b>${product.name}</b>.`);
  await notifyAdmin("free_claim", `${user.id}:${product.id}:${windowStart}`, `<b>Free claim</b>\nUser: ${user.telegramUserId}\nProduct: ${product.name}`);
}

async function createPurchase(chatId: number, userId: number, productId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const product = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!user || !product || product.stock <= 0 || !product.active) return sendMessage(chatId, "This product is unavailable.");
  const result = await db.insert(orders).values({ botUserId: user.id, productId: product.id, kind: "purchase", amountCents: product.priceCents, status: "pending" });
  const orderId = String(result[0]?.insertId ?? `${user.id}:${product.id}:${Date.now()}`);
  await sendMessage(chatId, `Order <b>#${orderId}</b> created for <b>${product.name}</b>. An admin will confirm fulfillment.`);
  await notifyAdmin("purchase", orderId, `<b>New purchase order #${orderId}</b>\nUser: ${user.telegramUserId}\nProduct: ${product.name}\nAmount: $${(product.priceCents / 100).toFixed(2)}`);
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
  if (data === "wallet") return showWallet(chatId, userId);
  if (data === "orders") return showOrders(chatId, userId);
  if (data === "profile") return showProfile(chatId, userId);
  if (data === "support") return sendMessage(chatId, "Send your support request as: /support your message");
  if (data.startsWith("claim:")) return claimFree(chatId, userId, Number(data.slice(6)));
  if (data.startsWith("buy:")) return createPurchase(chatId, userId, Number(data.slice(4)));
}

async function handleMessage(message: TelegramMessage) {
  const user = message.from;
  if (!user || !message.text) return;
  const [command, ...rest] = message.text.trim().split(/\s+/);
  const referral = rest.find((part) => part.startsWith("ref_"))?.slice(4);
  await ensureBotUser(user, referral);
  if (command === "/start") return showHome(message.chat.id, user.id);
  if (!(await requireAccess(message.chat.id, user.id))) return;
  if (command === "/shop") return showShop(message.chat.id);
  if (command === "/wallet") return showWallet(message.chat.id, user.id);
  if (command === "/orders") return showOrders(message.chat.id, user.id);
  if (command === "/profile") return showProfile(message.chat.id, user.id);
  if (command === "/support") {
    const body = rest.filter((part) => !part.startsWith("ref_")).join(" ").trim();
    if (!body) return sendMessage(message.chat.id, "Send your support request as: /support your message");
    const db = await getDb();
    if (!db) throw new Error("Database is unavailable");
    const botUser = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, user.id)).limit(1))[0];
    const ticketResult = await db.insert(supportTickets).values({ botUserId: botUser.id, message: body, status: "open" });
    const ticketId = String(ticketResult[0]?.insertId ?? `${user.id}:${Date.now()}`);
    await notifyAdmin("support", ticketId, `<b>New support ticket #${ticketId}</b>\nFrom: ${user.first_name ?? "User"} (${user.id})\n\n${body}`);
    return sendMessage(message.chat.id, `Your support request <b>#${ticketId}</b> has been submitted.`);
  }
  if (command === "/extra_device") return sendMessage(message.chat.id, "Extra-device requests are handled by support: /support extra device request");
  return showHome(message.chat.id, user.id);
}

export function validTelegramWebhookSecret(value: string | undefined) {
  return value && /^[A-Za-z0-9_-]{1,256}$/.test(value) ? value : undefined;
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

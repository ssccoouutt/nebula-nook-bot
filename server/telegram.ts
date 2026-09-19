import type { Request, Response } from "express";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { binancePayDeposits, botSettings, botUsers, broadcasts, freeClaims, notificationDeliveries, orders, paymentIntents, priceAlerts, products, referrals, supportTickets, telegramStarsWalletPayments, walletLedger } from "../drizzle/schema";
import { findBinancePayTransaction } from "./binancePay";
import { hasAccess, referralCodeForTelegramId, tierForReferralCount } from "../shared/botLogic";
import { flushDriveSync, scheduleDriveSync } from "./googleDrivePersistence";
import { encryptedConfigDiagnostics } from "./configFile";
import { formatBulkPricingForUsers, parseBulkPricing, resolveBulkUnitPriceCents } from "../shared/pricing";

type TelegramUser = { id: number; username?: string; first_name?: string; last_name?: string };
type TelegramChat = { id: number; type: string };
type TelegramSuccessfulPayment = { currency: string; total_amount: number; invoice_payload: string; telegram_payment_charge_id: string; provider_payment_charge_id?: string };
type TelegramMessage = { message_id: number; from?: TelegramUser; chat: TelegramChat; text?: string; caption?: string; photo?: Array<{ file_id: string }>; reply_markup?: unknown; reply_to_message?: TelegramMessage; successful_payment?: TelegramSuccessfulPayment };
type TelegramCallbackQuery = { id: string; from: TelegramUser; message?: TelegramMessage; data?: string };
type TelegramPreCheckoutQuery = { id: string; from: TelegramUser; currency: string; total_amount: number; invoice_payload: string };
type TelegramUpdate = { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery; pre_checkout_query?: TelegramPreCheckoutQuery; channel_post?: TelegramMessage };

const TELEGRAM_API = "https://api.telegram.org/bot";
const TELEGRAM_REQUEST_TIMEOUT_MS = 15_000;
const TELEGRAM_RETRY_DELAYS_MS = [250, 750] as const;

export function isTelegramTransientNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const causeCode = cause && typeof cause === "object" && "code" in cause ? String((cause as { code?: unknown }).code ?? "") : "";
  return /fetch failed|connect timeout|network|econnreset|etimedout|aborted/i.test(message) || /UND_ERR_CONNECT_TIMEOUT|ECONNRESET|ETIMEDOUT|ENETUNREACH|EAI_AGAIN/i.test(causeCode);
}

const DEFAULT_CHANNEL_ID = process.env.TELEGRAM_MEMBERSHIP_CHANNEL_ID ?? "-1004462190741";
const DEFAULT_GROUP_ID = process.env.TELEGRAM_MEMBERSHIP_GROUP_ID ?? "-5036785892";
const DEFAULT_CHANNEL_URL = process.env.TELEGRAM_CHANNEL_JOIN_URL ?? "https://t.me/+hwT_8FtgDU85Mzlk";
const DEFAULT_GROUP_URL = process.env.TELEGRAM_GROUP_JOIN_URL ?? "https://t.me/+4I-HIdE73NIyMzI8";
const PUBLIC_BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME ?? "Toolsmania_bot").replace(/^@/, "");
const recentRequests = new Map<number, number>();

export type PaymentOption = "wallet" | "binance_pay" | "bep20" | "telegram_stars";
const ALL_PAYMENT_OPTIONS: PaymentOption[] = ["wallet", "binance_pay", "bep20", "telegram_stars"];
let runtimePaymentOptionsOverride: Set<PaymentOption> | null = null;

export function parsePaymentOptionsList(raw: string): Set<PaymentOption> {
  const value = raw.trim();
  if (!value) return new Set(ALL_PAYMENT_OPTIONS);

  const aliases: Record<string, PaymentOption | "all"> = {
    all: "all", wallet: "wallet", binance: "binance_pay", binancepay: "binance_pay", binance_pay: "binance_pay",
    bep20: "bep20", usdt_bep20: "bep20", "usdt-bep20": "bep20",
    stars: "telegram_stars", telegramstars: "telegram_stars", telegram_stars: "telegram_stars", "telegram-stars": "telegram_stars",
  };
  const parsed = new Set<PaymentOption>();
  for (const token of raw.toLowerCase().split(/[\s,;]+/).filter(Boolean)) {
    const option = aliases[token];
    if (option === "all") return new Set(ALL_PAYMENT_OPTIONS);
    if (option) parsed.add(option);
  }
  return parsed.size ? parsed : new Set(ALL_PAYMENT_OPTIONS);
}

export function setRuntimePaymentOptions(raw: string) {
  const parsed = parsePaymentOptionsList(raw);
  if (!raw.trim()) throw new Error("Payment options cannot be blank; use all or a comma-separated list.");
  runtimePaymentOptionsOverride = parsed;
  return parsed;
}

export function enabledPaymentOptions(): Set<PaymentOption> {
  if (runtimePaymentOptionsOverride) return new Set(runtimePaymentOptionsOverride);
  return parsePaymentOptionsList(process.env.ENABLED_PAYMENT_OPTIONS ?? "");
}

export function isPaymentOptionEnabled(option: PaymentOption) {
  return enabledPaymentOptions().has(option);
}

function paymentButtonLabel(label: string, option: PaymentOption) {
  return isPaymentOptionEnabled(option) ? label : `${label} — unavailable`;
}

type PurchasePaymentCallback = { kind: "paywallet" | "paybinance" | "paybep20" | "paystars"; id: number; quantity: number };
function isPurchasePaymentCallback(action: TelegramCallbackAction): action is PurchasePaymentCallback {
  return ["paywallet", "paybinance", "paybep20", "paystars"].includes(action.kind);
}

export function paymentOptionForCallback(action: TelegramCallbackAction): PaymentOption | null {
  if (action.kind === "walletadd" || action.kind === "paybinance") return "binance_pay";
  if (action.kind === "walletbep20" || action.kind === "paybep20") return "bep20";
  if (action.kind === "walletstars" || action.kind === "walletstars_pay" || action.kind === "paystars") return "telegram_stars";
  if (action.kind === "paywallet") return "wallet";
  return null;
}

export function formatPaymentUnavailableMessage(option: PaymentOption) {
  const labels: Record<PaymentOption, string> = { wallet: "Wallet balance", binance_pay: "Binance Pay", bep20: "USDT (BEP20)", telegram_stars: "Telegram Stars" };
  return `⚠️ <b>${labels[option]}</b> is temporarily unavailable. Please choose another payment method.`;
}

type TelegramRuntimeFailure = {
  at: string;
  scope: string;
  message: string;
  context: Record<string, unknown>;
};

let lastTelegramFailure: TelegramRuntimeFailure | null = null;
type TelegramUpdateDiagnostic = {
  updateId: number;
  receivedAt: string;
  phase: "received" | "ignored" | "processing" | "completed" | "failed";
  reason?: string;
  storedCursor?: number;
};
let lastTelegramUpdate: TelegramUpdateDiagnostic | null = null;
let telegramUpdatesInFlight = 0;
let telegramCursorQueue: Promise<unknown> = Promise.resolve();

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function recordTelegramFailure(scope: string, error: unknown, context: Record<string, unknown> = {}) {
  const failure: TelegramRuntimeFailure = {
    at: new Date().toISOString(),
    scope,
    message: errorMessage(error),
    context,
  };
  lastTelegramFailure = failure;
  console.error(`[Telegram][Failure] ${JSON.stringify(failure)}`);
  return failure;
}

export function telegramRuntimeDiagnostics() {
  return { lastFailure: lastTelegramFailure, lastUpdate: lastTelegramUpdate, updatesInFlight: telegramUpdatesInFlight };
}

function updateContext(update: TelegramUpdate) {
  return {
    updateId: update.update_id,
    updateType: update.callback_query ? "callback_query" : update.message ? "message" : update.channel_post ? "channel_post" : "unknown",
    chatId: update.callback_query?.message?.chat.id ?? update.message?.chat.id ?? update.channel_post?.chat.id,
    messageId: update.callback_query?.message?.message_id ?? update.message?.message_id ?? update.channel_post?.message_id,
    callbackData: update.callback_query?.data,
    text: update.message?.text,
  };
}
// Telegram photo messages expose a caption rather than editable text. Keep a small
// bounded set of callback message keys so route handlers can retain their existing
// messageId-only signatures while respond() avoids editMessageText on media messages.
const nonTextCallbackMessages = new Set<string>();
const NON_TEXT_CALLBACK_MESSAGE_LIMIT = 2_000;

function callbackMessageKey(chatId: number, messageId: number) {
  return `${chatId}:${messageId}`;
}

export function rememberNonTextCallbackMessage(message: TelegramMessage | undefined) {
  if (!message || message.text !== undefined) return;
  nonTextCallbackMessages.add(callbackMessageKey(message.chat.id, message.message_id));
  if (nonTextCallbackMessages.size > NON_TEXT_CALLBACK_MESSAGE_LIMIT) {
    const oldest = nonTextCallbackMessages.values().next().value;
    if (oldest) nonTextCallbackMessages.delete(oldest);
  }
}
const pendingCustomQuantities = new Map<number, { productId: number; expiresAt: number }>();
const pendingBinancePayTopups = new Map<number, { amountCents?: number; method: "binance_pay" | "bep20"; createdAt?: number; expiresAt: number }>();
const pendingTelegramStarsWalletTopups = new Map<number, { amountCents?: number; createdAt?: number; expiresAt: number }>();
type SupportCategory = "completed_order" | "payment_verification" | "bot_issue" | "other";
type SupportDraft = { step: "category" | "order" | "payment_method" | "description"; category?: SupportCategory; orderId?: number; paymentMethod?: string; expiresAt: number };
const pendingSupportMessages = new Map<number, SupportDraft>();
const SUPPORT_MESSAGE_WINDOW_MS = 20 * 60 * 1000;
const SUPPORT_TICKET_PAGE_SIZE = 5;
const pendingBinancePayPurchases = new Map<number, { intentId: number; expiresAt: number }>();
export const BINANCE_PAY_PURCHASE_WINDOW_MS = 20 * 60 * 1000;
export const BEP20_PURCHASE_WINDOW_MS = 30 * 60 * 1000;
export const TELEGRAM_STARS_PER_USD = 100 / 1.2;
export function usdCentsToTelegramStars(amountCents: number) {
  // 100 XTR = $1.20, or 5 Stars per 6 cents. Integer arithmetic avoids floating-point drift.
  return Math.max(1, Math.ceil((Math.max(0, amountCents) * 5) / 6));
}

export function telegramStarsToUsdEquivalent(stars: number) {
  return stars / TELEGRAM_STARS_PER_USD;
}

export function didInsertReferralRow(result: unknown) {
  if (result && typeof result === "object" && !Array.isArray(result) && "changes" in result) return Number((result as { changes?: unknown }).changes ?? 0) > 0;
  return extractInsertedRowId(result) > 0;
}

export function extractInsertedRowId(result: unknown) {
  const candidate = Array.isArray(result) ? result[0] : result;
  const row = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : undefined;
  const value = row?.insertId ?? row?.lastInsertRowid;
  const id = Number(value ?? 0);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

export function isLikelyBinancePayTransactionId(value: string) {
  return /^\d{8,32}$/.test(value.trim());
}

export function isLikelyBep20TransactionHash(value: string) {
  return /^0x[a-fA-F0-9]{64}$/.test(value.trim());
}

export function isLikelyPaymentTransactionId(value: string) {
  return isLikelyBinancePayTransactionId(value) || isLikelyBep20TransactionHash(value);
}

export function shouldRoutePendingBinancePurchase(messageText: string, isCommandMessage: boolean, hasPendingTopup: boolean, hasPendingPurchase: boolean) {
  return !isCommandMessage && !hasPendingTopup && hasPendingPurchase && isLikelyPaymentTransactionId(messageText);
}

/**
 * Telegram update IDs are currently well below this guard. A value far beyond
 * that range indicates a synthetic/corrupt cursor and must not block real
 * updates forever after a diagnostic probe or bad restore.
 */
export const TELEGRAM_UPDATE_ID_GUARD = 2_000_000_000;

export function shouldIgnoreTelegramUpdate(lastUpdateId: number | undefined, updateId: number) {
  if (lastUpdateId === undefined || !Number.isFinite(lastUpdateId)) return false;
  if (lastUpdateId >= TELEGRAM_UPDATE_ID_GUARD) return false;
  return updateId <= lastUpdateId;
}

/** New users start with a zero wallet; only verified payments or admin credits change balance. */
export const TESTING_WALLET_CREDIT_CENTS = 0;
export const TESTING_WALLET_CREDIT_REFERENCE = "testing-wallet-credit-disabled";

export const DEFAULT_TESTING_PRODUCTS = [
  { name: "ChatGPT Starter Access", description: "Testing catalog item for guided account access delivery.", priceCents: 299, stock: 25, active: 1, freeEligible: 0, freeWindowMs: null },
  { name: "Gemini Pro Trial Link", description: "Limited testing coupon/link item with automatic delivery.", priceCents: 99, stock: 40, active: 1, freeEligible: 1, freeWindowMs: 86400000 },
  { name: "Surfshark Trial Coupon", description: "Testing coupon/link item. Delivery details are provided after fulfillment.", priceCents: 100, stock: 20, active: 1, freeEligible: 0, freeWindowMs: null },
  { name: "Canva Creator Access", description: "Testing digital-service item for the ToolsMania catalog.", priceCents: 250, stock: 15, active: 1, freeEligible: 0, freeWindowMs: null },
  { name: "CapCut Premium Trial", description: "Testing digital-service item with limited stock.", priceCents: 220, stock: 12, active: 1, freeEligible: 0, freeWindowMs: null },
  { name: "Notion Plus Coupon", description: "Testing productivity-service coupon with automatic delivery.", priceCents: 200, stock: 10, active: 1, freeEligible: 0, freeWindowMs: null },
] as const;

async function telegramCall<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  let lastError: unknown;
  for (let attempt = 0; attempt <= TELEGRAM_RETRY_DELAYS_MS.length; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TELEGRAM_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${TELEGRAM_API}${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await response.json()) as { ok: boolean; result?: T; description?: string };
      if (!json.ok) throw new Error(json.description ?? `Telegram ${method} failed`);
      return json.result as T;
    } catch (error) {
      lastError = error;
      if (!isTelegramTransientNetworkError(error) || attempt === TELEGRAM_RETRY_DELAYS_MS.length) {
        recordTelegramFailure("telegram_api", error, { method, chatId: body.chat_id, messageId: body.message_id, attempt: attempt + 1 });
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, TELEGRAM_RETRY_DELAYS_MS[attempt]));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Telegram ${method} failed`);
}

export function normalizeTelegramMessageText(text: string) {
  return text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
}
async function sendMessage(chatId: number, text: string, replyMarkup?: unknown) {
  return telegramCall("sendMessage", { chat_id: chatId, text: normalizeTelegramMessageText(text), parse_mode: "HTML", reply_markup: replyMarkup });
}

async function sendStarsInvoice(chatId: number, title: string, description: string, payload: string, stars: number) {
  return telegramCall("sendInvoice", { chat_id: chatId, title, description, payload, provider_token: "", currency: "XTR", prices: [{ label: title, amount: stars }] });
}

async function editMessage(chatId: number, messageId: number, text: string, replyMarkup?: unknown) {
  return telegramCall("editMessageText", { chat_id: chatId, message_id: messageId, text: normalizeTelegramMessageText(text), parse_mode: "HTML", reply_markup: replyMarkup });
}

async function sendPhoto(chatId: number, photo: string, caption: string, replyMarkup?: unknown) {
  return telegramCall("sendPhoto", { chat_id: chatId, photo, caption, parse_mode: "HTML", reply_markup: replyMarkup });
}

async function sendPhotoUpload(chatId: number, imageUrl: string, caption: string, replyMarkup?: unknown) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(imageUrl, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) throw new Error(`image URL returned HTTP ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (!contentType.startsWith("image/")) throw new Error(`image URL returned ${contentType || "non-image content"}`);
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > 10 * 1024 * 1024) throw new Error("image exceeds Telegram's 10 MB upload limit");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("image exceeds Telegram's 10 MB upload limit");
    const extension = contentType.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "jpg";
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("photo", new Blob([bytes], { type: contentType }), `product.${extension}`);
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
    if (replyMarkup !== undefined) form.append("reply_markup", JSON.stringify(replyMarkup));
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    const telegramResponse = await fetch(`${TELEGRAM_API}${token}/sendPhoto`, { method: "POST", body: form });
    const json = (await telegramResponse.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!json.ok) throw new Error(json.description ?? "Telegram sendPhoto upload failed");
    return json.result;
  } finally {
    clearTimeout(timeout);
  }
}

export function hasProductImage(imageUrl: string | null | undefined) {
  return Boolean(imageUrl?.trim());
}

export function isHttpProductImageUrl(imageUrl: string | null | undefined) {
  if (!hasProductImage(imageUrl)) return false;
  try {
    const url = new URL(imageUrl!.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function telegramResponseMethod(messageId?: number, editFailed = false) {
  return messageId === undefined || editFailed ? "sendMessage" as const : "editMessageText" as const;
}

export function isTelegramMessageNotModifiedError(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("message is not modified");
}

export function telegramUpdateIgnoreReason(storedCursor: number | undefined, updateId: number) {
  return shouldIgnoreTelegramUpdate(storedCursor, updateId) ? "older_or_duplicate_update_id" as const : undefined;
}

async function claimTelegramUpdate(updateId: number) {
  const previous = telegramCursorQueue;
  let release!: () => void;
  telegramCursorQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const db = await getDb();
    if (!db) return true;
    const last = (await db.select().from(botSettings).where(eq(botSettings.key, "last_update_id")).limit(1))[0];
    const lastUpdateId = last ? Number(last.value) : undefined;
    lastTelegramUpdate = { updateId, receivedAt: new Date().toISOString(), phase: "received", storedCursor: Number.isFinite(lastUpdateId) ? lastUpdateId : undefined };
    const ignoredReason = telegramUpdateIgnoreReason(lastUpdateId, updateId);
    if (ignoredReason) {
      lastTelegramUpdate = { ...lastTelegramUpdate, phase: "ignored", reason: ignoredReason };
      console.warn(`[Telegram] Ignored update ${updateId}; stored cursor is ${lastUpdateId}`);
      return false;
    }
    await db.insert(botSettings).values({ key: "last_update_id", value: String(updateId) }).onConflictDoUpdate({ target: botSettings.key, set: { value: String(updateId) } });
    return true;
  } finally {
    release();
  }
}


export async function respond(chatId: number, text: string, replyMarkup?: unknown, messageId?: number) {
  const cannotEditText = messageId !== undefined && nonTextCallbackMessages.has(callbackMessageKey(chatId, messageId));
  if (telegramResponseMethod(messageId) === "sendMessage" || cannotEditText) return sendMessage(chatId, text, replyMarkup);
  try {
    return await editMessage(chatId, messageId as number, text, replyMarkup);
  } catch (error) {
    if (isTelegramMessageNotModifiedError(error)) return undefined;
    // This includes photo messages, empty messages, stale message IDs, and other
    // Telegram edit constraints. A fresh text message is the reliable recovery.
    console.error("[Telegram] editMessageText unavailable; sending a fresh response", error);
    return sendMessage(chatId, text, replyMarkup);
  }
}

export async function sendTelegramMessage(chatId: number, text: string) {
  return sendMessage(chatId, text);
}

export function formatProductAvailabilityAnnouncement(product: { name: string; description: string; priceCents: number; stock: number }, reason: "new_product" | "new_stock") {
  const title = reason === "new_product" ? "🆕 <b>New product available</b>" : "📦 <b>New stock added</b>";
  const name = product.name.replace(/[<&>]/g, "");
  const description = product.description.replace(/[<&>]/g, "");
  return `${title}\n\n✨ <b>${name}</b>\n\n${description}\n\n━━━━━━━━━━━━━━\n💵 Price: <b>$${(product.priceCents / 100).toFixed(2)}</b> per unit\n📦 Stock: <b>${product.stock}</b> available\n\nTap <b>Buy now</b> to order while stock lasts.`;
}

export async function notifyProductAvailability(product: { id: number; name: string; description: string; priceCents: number; stock: number }, reason: "new_product" | "new_stock", referenceSuffix: string) {
  const db = await getDb();
  if (!db || product.stock <= 0) return { sent: 0, skipped: 0, failed: 0 };
  const text = formatProductAvailabilityAnnouncement(product, reason);
  const replyMarkup = buildProductKeyboard(product.id);
  const users = await db.select().from(botUsers);
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const user of users) {
    const referenceId = `${product.id}:${referenceSuffix}:${user.id}`;
    const existing = await db.select({ status: notificationDeliveries.status }).from(notificationDeliveries).where(and(eq(notificationDeliveries.eventType, "product_available"), eq(notificationDeliveries.referenceId, referenceId))).limit(1);
    if (existing[0]?.status === "sent") {
      skipped += 1;
      continue;
    }
    await db.insert(notificationDeliveries).values({ botUserId: user.id, eventType: "product_available", referenceId, status: "queued" }).onConflictDoUpdate({ target: [notificationDeliveries.eventType, notificationDeliveries.referenceId], set: { status: "queued", error: null } });
    try {
      await sendMessage(user.telegramUserId, text, replyMarkup);
      await db.update(notificationDeliveries).set({ status: "sent", sentAt: new Date(), error: null }).where(and(eq(notificationDeliveries.eventType, "product_available"), eq(notificationDeliveries.referenceId, referenceId)));
      sent += 1;
    } catch (error) {
      failed += 1;
      await db.update(notificationDeliveries).set({ status: "failed", error: error instanceof Error ? error.message : "product notification failed" }).where(and(eq(notificationDeliveries.eventType, "product_available"), eq(notificationDeliveries.referenceId, referenceId)));
    }
  }
  return { sent, skipped, failed };
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

export function buildConfirmedPurchasePlan(balanceCents: number, priceCents: number, stock: number, quantity: number, bulkPricing?: string | null) {
  const safeQuantity = Math.max(1, Math.min(10, Math.floor(quantity)));
  const unitPriceCents = resolveBulkUnitPriceCents(priceCents, bulkPricing, safeQuantity);
  const purchase = buildAutoPurchaseResult(balanceCents, unitPriceCents, stock, safeQuantity);
  if (!purchase.ok) return { ok: false as const, status: purchase.status, totalCents: purchase.totalCents };
  return { ok: true as const, quantity: purchase.quantity, totalCents: purchase.totalCents, nextBalanceCents: purchase.nextBalanceCents, nextStock: purchase.nextStock };
}

export function formatHomeMessage(details?: { firstName?: string | null; username?: string | null; tier?: string | null; balanceCents?: number; totalSpentCents?: number; referrals?: number; access?: boolean }) {
  const name = (details?.firstName ?? "there").replace(/[<&>]/g, "");
  const access = details?.access === false ? "🔒 Membership required" : "✅ Membership active";
  return `👋 <b>Welcome to ToolsMania!</b>\n\nHey <b>${name}</b>! 👋\n\nWe offer premium digital products at the best prices — fast, secure, and reliable delivery.\n\n<blockquote>🛍️ <b>Shop</b> — Browse and buy digital products\n👤 <b>My Profile</b> — Account, balance, and orders\n💰 <b>Deposit</b> — Add funds to your wallet\n🛠️ <b>Developer API</b> — Reseller and automated ordering\n⭐ <b>Refer & Earn</b> — Invite friends and earn rewards</blockquote>\n\n${access}\n\nChoose an option below to continue:`;
}

export function formatDeveloperApiMessage() {
  return "🛠️ <b>Developer API</b>\n\nDeveloper API access is not enabled for this bot yet. Please contact Support if you need reseller or automated ordering access.";
}

export function formatMembershipMessage() {
  return "🔐 <b>Membership required</b>\n\nJoin both ToolsMania spaces below, then tap <b>✅ I have joined</b> to unlock the bot.";
}

export function formatSupportPrompt() {
  return "🆘 <b>Support</b>\n\nChoose the type of issue you need help with, then send the requested details in your next message.\n\n⏱️ Replies can take up to <b>24 hours</b>, although they normally arrive much sooner. Please avoid creating duplicate tickets for the same issue.";
}
export function formatSupportDescriptionPrompt(category: SupportCategory, context?: { orderName?: string; paymentMethod?: string }) {
  if (category === "payment_verification") return `💳 <b>Payment verification support</b>\n\nPayment method: <b>${context?.paymentMethod ?? "Not selected"}</b>\n\nPlease describe the issue and include:\n• how much you sent\n• the exact auto-verification error\n• your transaction hash\n\n⏱️ Replies can take up to <b>24 hours</b>, normally much sooner. Avoid duplicate tickets.`;
  if (category === "completed_order") return `📦 <b>Completed-order support</b>\n\nRelated product: <b>${context?.orderName ?? "Selected order"}</b>\n\nPlease describe the issue with this completed order. Include any relevant delivery details.\n\n⏱️ Replies can take up to <b>24 hours</b>, normally much sooner. Avoid duplicate tickets.`;
  return `📝 <b>${category === "bot_issue" ? "Bot issue support" : "Other support"}</b>\n\nPlease describe the issue clearly.\n\n⏱️ Replies can take up to <b>24 hours</b>, normally much sooner. Avoid duplicate tickets.`;
}
export function supportDescriptionKeyboard() {
  return keyboard([[{ text: "✖️ Cancel", callback_data: "support_cancel" }]]);
}
export function formatSupportTicketDetail(ticket: { id: number; category?: string | null; status: string; message: string; paymentMethod?: string | null; paymentAmountCents?: number | null; transactionHash?: string | null; adminReply?: string | null; orderName?: string | null; createdAt: Date | string }) {
  const category = (ticket.category ?? "other").replaceAll("_", " ");
  const context = ticket.orderName ? `\n📦 Product: <b>${ticket.orderName.replace(/[<&>]/g, "")}</b>` : "";
  const payment = ticket.paymentMethod ? `\n💳 Payment method: <b>${ticket.paymentMethod.replace(/[<&>]/g, "")}</b>` : "";
  const amount = ticket.paymentAmountCents ? `\n💰 Amount sent: <b>$${(ticket.paymentAmountCents / 100).toFixed(2)}</b>` : "";
  const hash = ticket.transactionHash ? `\n🧾 Transaction hash: <code>${ticket.transactionHash.replace(/[<&>]/g, "")}</code>` : "";
  const reply = ticket.adminReply?.trim() ? `\n\n💬 <b>Admin answer</b>\n${ticket.adminReply.replace(/[<&>]/g, "")}` : "\n\n💬 No admin answer yet.";
  const created = new Date(ticket.createdAt).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return `🆘 <b>Support ticket #${ticket.id}</b>\n\n📌 Status: <b>${ticket.status}</b>\n🏷️ Category: <b>${category}</b>${context}${payment}${amount}${hash}\n🗓️ Created: <b>${created}</b>\n\n📝 <b>Your message</b>\n${ticket.message.replace(/[<&>]/g, "")}${reply}`;
}

export function formatSupportSubmitted(ticketId: string) {
  return `✅ <b>Support request received</b>\n\nTicket: <b>#${ticketId}</b>\nOur team will review it shortly. Replies can take up to <b>24 hours</b>, although they normally arrive much sooner. Please avoid duplicate tickets; use <b>My tickets</b> to check the status and replies.`;
}
function supportCategoryKeyboard() {
  return keyboard([
    [{ text: "📦 Completed order", callback_data: "support_category:completed_order" }],
    [{ text: "💳 Payment verification", callback_data: "support_category:payment_verification" }],
    [{ text: "🤖 Bot issue", callback_data: "support_category:bot_issue" }],
    [{ text: "📝 Other", callback_data: "support_category:other" }],
    [{ text: "📋 My tickets", callback_data: "support_history" }, { text: "✖️ Cancel", callback_data: "support_cancel" }],
  ]);
}
function supportPaymentKeyboard() {
  return keyboard([
    [{ text: "💳 Wallet", callback_data: "support_payment:1" }],
    [{ text: "🔶 Binance Pay", callback_data: "support_payment:2" }],
    [{ text: "🪙 USDT BEP20", callback_data: "support_payment:3" }],
    [{ text: "⭐ Telegram Stars", callback_data: "support_payment:4" }],
    [{ text: "↩️ Back", callback_data: "support_new" }, { text: "✖️ Cancel", callback_data: "support_cancel" }],
  ]);
}
function supportPaymentName(id: number) {
  return ({ 1: "Wallet", 2: "Binance Pay", 3: "USDT BEP20", 4: "Telegram Stars" } as Record<number, string>)[id];
}
function supportCategoryLabel(category: string | null | undefined) {
  return ({ completed_order: "completed order", payment_verification: "payment verification", bot_issue: "bot issue", other: "other" } as Record<string, string>)[category ?? "other"] ?? "other";
}
function supportTicketListKeyboard(rows: Array<{ id: number; status: string; category: string | null }>, page: number, pageCount: number) {
  const buttons: TelegramButton[][] = rows.map((ticket) => [{ text: `#${ticket.id} · ${ticket.status} · ${supportCategoryLabel(ticket.category)}`.slice(0, 64), callback_data: `ticket_detail:${ticket.id}` }]);
  const navigation: TelegramButton[] = [];
  if (page > 0) navigation.push({ text: "⬅️ Newer tickets", callback_data: `tickets_page:${page - 1}` });
  if (page < pageCount - 1) navigation.push({ text: "➡️ Older tickets", callback_data: `tickets_page:${page + 1}` });
  if (navigation.length) buttons.push(navigation);
  buttons.push([{ text: "➕ New ticket", callback_data: "support_new" }, { text: "⌂ Home", callback_data: "home" }]);
  return keyboard(buttons);
}
function supportTicketDetailKeyboard() {
  return keyboard([[{ text: "📋 My tickets", callback_data: "support_history" }], [{ text: "➕ New ticket", callback_data: "support_new" }, { text: "⌂ Home", callback_data: "home" }]]);
}

export function formatBotInfoMessage(totalUsers: number, completedOrders: number) {
  return `ℹ️ <b>ToolsMania Bot Info</b>\n\n👥 Total bot users: <b>${totalUsers}</b>\n✅ Total completed orders: <b>${completedOrders}</b>`;
}

export function diagnoseConfiguredAdminChatId(values: { legacy?: string } = {}) {
  const source = values.legacy !== undefined ? "explicit" : "process.env.TELEGRAM_ADMIN_CHAT_ID";
  const configured = values.legacy !== undefined ? values.legacy : process.env.TELEGRAM_ADMIN_CHAT_ID;
  const raw = configured == null ? "" : String(configured);
  const trimmed = raw.trim();
  const numeric = trimmed === "" ? null : Number(trimmed);
  const valid = numeric !== null && Number.isSafeInteger(numeric) && numeric > 0;
  const masked = trimmed.length > 4 ? `${trimmed.slice(0, 2)}••••${trimmed.slice(-2)}` : trimmed ? "••••" : null;
  let reason = "valid positive private chat ID";
  if (configured == null) reason = "TELEGRAM_ADMIN_CHAT_ID is absent from process.env; cfg.enc did not apply that key at startup";
  else if (!trimmed) reason = "TELEGRAM_ADMIN_CHAT_ID is blank after trimming";
  else if (!/^\d+$/.test(trimmed)) reason = "TELEGRAM_ADMIN_CHAT_ID must contain digits only; group/channel IDs beginning with '-' are rejected for private support";
  else if (!valid) reason = "TELEGRAM_ADMIN_CHAT_ID is not a positive safe integer";
  return {
    source,
    rawPresent: raw.length > 0,
    rawLength: raw.length,
    trimmedLength: trimmed.length,
    masked,
    numeric,
    valid,
    reason,
    encryptedConfig: encryptedConfigDiagnostics(),
  };
}

export function resolveConfiguredAdminChatId(values: { legacy?: string } = {}) {
  const diagnostic = diagnoseConfiguredAdminChatId(values);
  return diagnostic.valid ? diagnostic.numeric : null;
}
function configuredAdminChatId() {
  return resolveConfiguredAdminChatId();
}

async function deliverSupportTicket(ticketId: string, user: TelegramUser, body: string) {
  const adminChatId = configuredAdminChatId();
  if (adminChatId === null) {
    const diagnostic = diagnoseConfiguredAdminChatId();
    throw new Error(`Support admin ID rejected: ${diagnostic.reason}; source=${diagnostic.source}; rawPresent=${diagnostic.rawPresent}; rawLength=${diagnostic.rawLength}; trimmedLength=${diagnostic.trimmedLength}; masked=${diagnostic.masked ?? "<none>"}; cfgPath=${diagnostic.encryptedConfig.path}; cfgLoaded=${diagnostic.encryptedConfig.loaded}; cfgAdminKey=${diagnostic.encryptedConfig.keys.includes("TELEGRAM_ADMIN_CHAT_ID")}`);
  }
  await sendMessage(adminChatId, `<b>New support ticket #${ticketId}</b>\nFrom: ${user.first_name ?? "User"}${user.username ? ` (@${user.username})` : ""}\nTelegram ID: <code>${user.id}</code>\n\n${body}\n\nReply with:\n<code>/reply ${ticketId} your response</code>`);
}

async function submitSupportTicket(user: TelegramUser, body: string, draft: SupportDraft = { step: "description", category: "other", expiresAt: Date.now() }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const botUser = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, user.id)).limit(1))[0];
  if (!botUser) throw new Error("Support user account is unavailable");
  // Use SQLite RETURNING so duplicate messages cannot cause the notification to
  // reference an older open ticket. The returned ID is the exact row inserted and
  // is therefore the same ID used by the admin list, /reply, and /close.
  const amountMatch = draft.category === "payment_verification" ? (body.match(/(?:\$|usd\s*)?(\d+(?:\.\d{1,2})?)\s*(?:usd|\$)/i) ?? body.match(/(?:amount|sent)\D+(\d+(?:\.\d{1,2})?)/i)) : null;
  const hashMatch = draft.category === "payment_verification" ? body.match(/(?:hash|txid|transaction)\D*([A-Za-z0-9_-]{12,})/i) : null;
  const paymentAmountCents = amountMatch ? Math.round(Number(amountMatch[1]) * 100) : null;
  const transactionHash = hashMatch?.[1] ?? null;
  const insertedTicket = (await db.insert(supportTickets)
    .values({ botUserId: botUser.id, message: body, status: "open", category: draft.category ?? "other", relatedOrderId: draft.orderId ?? null, paymentMethod: draft.paymentMethod ?? null, paymentAmountCents, transactionHash })
    .returning({ id: supportTickets.id }))[0];
  if (!insertedTicket?.id) throw new Error("Failed to create support ticket ID");
  const ticketId = String(insertedTicket.id);
  await deliverSupportTicket(ticketId, user, `${body}\n\n🏷️ Category: ${draft.category ?? "other"}${draft.orderId ? `\n📦 Related order: #${draft.orderId}` : ""}${draft.paymentMethod ? `\n💳 Payment method: ${draft.paymentMethod}` : ""}${paymentAmountCents ? `\n💰 Amount sent: $${(paymentAmountCents / 100).toFixed(2)}` : ""}${transactionHash ? `\n🧾 Transaction hash: ${transactionHash}` : ""}`);
  scheduleDriveSync("support_ticket");
  return ticketId;
}

async function showSupportMenu(chatId: number, messageId?: number) {
  await respond(chatId, formatSupportPrompt(), supportCategoryKeyboard(), messageId);
}

async function showSupportOrderPicker(chatId: number, userId: number, page = 0, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const allOrders = user ? await db.select().from(orders).where(and(eq(orders.botUserId, user.id), or(eq(orders.status, "fulfilled"), eq(orders.status, "paid")))).orderBy(desc(orders.createdAt)) : [];
  const pageCount = Math.max(1, Math.ceil(allOrders.length / SUPPORT_TICKET_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);
  const pageOrders = allOrders.slice(safePage * SUPPORT_TICKET_PAGE_SIZE, (safePage + 1) * SUPPORT_TICKET_PAGE_SIZE);
  const productIds = Array.from(new Set(pageOrders.map((order) => order.productId)));
  const productRows = productIds.length ? await db.select().from(products).where(inArray(products.id, productIds)) : [];
  const productById = new Map(productRows.map((product) => [product.id, product.name]));
  const buttons: TelegramButton[][] = pageOrders.map((order) => [{ text: `#${order.id} · ${productById.get(order.productId) ?? `Product #${order.productId}`}`.slice(0, 64), callback_data: `support_order:${order.id}` }]);
  if (!buttons.length) return respond(chatId, "📦 You do not have any completed orders to attach to this ticket.", supportCategoryKeyboard(), messageId);
  const navigation: TelegramButton[] = [];
  if (safePage > 0) navigation.push({ text: "⬅️ Newer orders", callback_data: `support_page:${safePage - 1}` });
  if (safePage < pageCount - 1) navigation.push({ text: "➡️ Older orders", callback_data: `support_page:${safePage + 1}` });
  if (navigation.length) buttons.push(navigation);
  buttons.push([{ text: "↩️ Back", callback_data: "support_new" }, { text: "✖️ Cancel", callback_data: "support_cancel" }]);
  await respond(chatId, `📦 <b>Which completed order is related?</b>\n\nChoose one order below. Page <b>${safePage + 1}</b> of <b>${pageCount}</b>.`, keyboard(buttons), messageId);
}

async function showSupportHistory(chatId: number, userId: number, page = 0, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const rows = user ? await db.select().from(supportTickets).where(eq(supportTickets.botUserId, user.id)).orderBy(desc(supportTickets.createdAt)) : [];
  const pageCount = Math.max(1, Math.ceil(rows.length / SUPPORT_TICKET_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);
  const pageRows = rows.slice(safePage * SUPPORT_TICKET_PAGE_SIZE, (safePage + 1) * SUPPORT_TICKET_PAGE_SIZE);
  if (!pageRows.length) return respond(chatId, "📋 <b>My support tickets</b>\n\nYou have not created any support tickets yet.", supportCategoryKeyboard(), messageId);
  await respond(chatId, `📋 <b>My support tickets</b>\n\nChoose a ticket to view its message, status, and admin answer. Page <b>${safePage + 1}</b> of <b>${pageCount}</b>.`, supportTicketListKeyboard(pageRows.map((ticket) => ({ id: ticket.id, status: ticket.status, category: ticket.category })), safePage, pageCount), messageId);
}

async function showSupportTicketDetail(chatId: number, userId: number, ticketId: number, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const ticket = user ? (await db.select().from(supportTickets).where(and(eq(supportTickets.id, ticketId), eq(supportTickets.botUserId, user.id))).limit(1))[0] : undefined;
  if (!ticket) return respond(chatId, "⚠️ That support ticket was not found in your account.", supportTicketDetailKeyboard(), messageId);
  const order = ticket.relatedOrderId ? (await db.select().from(orders).where(eq(orders.id, ticket.relatedOrderId)).limit(1))[0] : undefined;
  const product = order ? (await db.select().from(products).where(eq(products.id, order.productId)).limit(1))[0] : undefined;
  await respond(chatId, formatSupportTicketDetail({ ...ticket, orderName: product?.name ?? null }), supportTicketDetailKeyboard(), messageId);
}

async function beginSupportCategory(chatId: number, userId: number, category: SupportCategory, messageId?: number) {
  const expiresAt = Date.now() + SUPPORT_MESSAGE_WINDOW_MS;
  if (category === "completed_order") {
    pendingSupportMessages.set(userId, { step: "order", category, expiresAt });
    return showSupportOrderPicker(chatId, userId, 0, messageId);
  }
  if (category === "payment_verification") {
    pendingSupportMessages.set(userId, { step: "payment_method", category, expiresAt });
    return respond(chatId, "💳 <b>Which payment method did you use?</b>", supportPaymentKeyboard(), messageId);
  }
  pendingSupportMessages.set(userId, { step: "description", category, expiresAt });
    return respond(chatId, formatSupportDescriptionPrompt(category), supportDescriptionKeyboard(), messageId);
}

export function isAuthorizedAdminMessage(message: Pick<TelegramMessage, "chat" | "from">) {
  const adminChatId = configuredAdminChatId();
  return Boolean(adminChatId && message.chat.type === "private" && message.chat.id === adminChatId && message.from?.id === adminChatId);
}

export function formatAdminHomeMessage() {
  return "🔐 <b>ToolsMania Admin Control Center</b>\n\nThis private menu is visible only to the configured administrator.\n\nUse <code>/reply &lt;ticket-id&gt; &lt;message&gt;</code> to answer a support ticket. Use the admin controls below to view bot statistics.";
}

export function parseAdminReplyCommand(text?: string) {
  const normalized = String(text ?? "").trim();
  const match = normalized.match(/^\/reply(?:@[^\s]+)?\s+#?(\d+)\s+([\s\S]+)$/i);
  if (!match) return null;
  const ticketId = Number(match[1]);
  const response = match[2].trim();
  if (!Number.isSafeInteger(ticketId) || ticketId < 1 || !response) return null;
  return { ticketId, response };
}

export function buildAdminKeyboard() {
  return keyboard([
    [{ text: "ℹ️ Bot Statistics", callback_data: "admin_stats", style: "primary" }],
    [{ text: "🆘 Open Tickets", callback_data: "admin_tickets", style: "danger" }],
    [{ text: "📢 Broadcast Help", callback_data: "admin_broadcast_help", style: "primary" }],
    [{ text: "⚙️ Bot Settings", callback_data: "admin_settings", style: "primary" }],
    [{ text: "🔎 Account Diagnostics", callback_data: "admin_diagnostics", style: "primary" }],
    [{ text: "🗑️ Delete User Help", callback_data: "admin_delete_help", style: "danger" }],
  ]);
}

function telegramDeliveryFailureCategory(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/blocked by the user|bot was blocked/i.test(message)) return "blocked the bot";
  if (/chat not found|user not found/i.test(message)) return "chat not found (possibly deleted account or invalid chat)";
  if (/deactivated/i.test(message)) return "Telegram account deactivated";
  return message.slice(0, 180);
}

export function normalizeAdminTicketText(value: unknown) {
  return String(value ?? "").replace(/\\n/g, "\n").replace(/\\r\\n/g, "\n").replace(/[<&>]/g, "");
}

export function formatAdminTelegramId(value: unknown) {
  const normalized = String(value ?? "").trim();
  return /^-?\d+$/.test(normalized) ? normalized : "unavailable in stored record";
}

export function parseAdminCloseTicketCommand(text?: string) {
  const match = String(text ?? "").trim().match(/^\/close(?:@[^\s]+)?\s+#?(\d+)$/i);
  if (!match) return null;
  const ticketId = Number(match[1]);
  return Number.isSafeInteger(ticketId) && ticketId > 0 ? ticketId : null;
}

function adminTicketText(value: unknown) {
  return normalizeAdminTicketText(value);
}

function adminTelegramId(value: unknown) {
  return formatAdminTelegramId(value);
}

function buildAdminTicketKeyboard(ticketIds: number[]) {
  return keyboard([
    ...ticketIds.map((ticketId) => [{ text: `✅ Close #${ticketId}`, callback_data: `admin_close_ticket:${ticketId}`, style: "danger" as const }]),
    [{ text: "↻ Refresh tickets", callback_data: "admin_tickets", style: "primary" as const }],
    [{ text: "⌂ Admin menu", callback_data: "admin_stats", style: "primary" as const }],
  ]);
}
export function formatAdminTicketRecord(row: { ticketId: number; message: string; createdAt: Date | string | number; username?: string | null; telegramUserId?: number | string | null }) {
  const createdAt = row.createdAt instanceof Date ? row.createdAt.toISOString() : adminTicketText(row.createdAt);
  return `🆘 <b>Ticket #${row.ticketId}</b>\n👤 Username: <b>${row.username ? `@${adminTicketText(row.username)}` : "No username"}</b>\n🆔 Telegram ID: <code>${adminTelegramId(row.telegramUserId)}</code>\n🗓️ ${createdAt}\n\n${adminTicketText(row.message)}\n\nReply: <code>/reply ${row.ticketId} your response</code>\nClose without replying: <code>/close ${row.ticketId}</code>`;
}
async function showAdminTickets(chatId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  // Keep the ticket primary key and joined user fields explicitly aliased. Nested
  // object hydration through sqlite-proxy can otherwise make botUsers.id appear
  // where supportTickets.id is expected in the administrator view.
  const rows = await db.select({
    ticketId: supportTickets.id,
    message: supportTickets.message,
    createdAt: supportTickets.createdAt,
    username: botUsers.username,
    telegramUserId: botUsers.telegramUserId,
  }).from(supportTickets).leftJoin(botUsers, eq(supportTickets.botUserId, botUsers.id)).where(eq(supportTickets.status, "open")).orderBy(desc(supportTickets.createdAt)).limit(1000);
  if (!rows.length) return sendMessage(chatId, "✅ <b>Open tickets</b>\n\nThere are no open support tickets.", buildAdminKeyboard());
  const text = rows.map((row) => formatAdminTicketRecord(row)).join("\n\n━━━━━━━━━━━━━━\n\n");
  return sendMessage(chatId, `<b>🆘 Open support tickets</b>\n\n${text}`, buildAdminTicketKeyboard(rows.map((row) => row.ticketId)));
}

export function formatAdminTicketClosedMessage(ticketId: number) {
  return `✅ Support ticket #${ticketId} was closed. Google Drive synchronization is queued in the background.`;
}
async function closeAdminTicket(chatId: number, ticketId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const updatedAt = new Date();
  const changed = await db.update(supportTickets)
    .set({ status: "closed", updatedAt })
    .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.status, "open")));
  const changedCount = Number((changed as { changes?: unknown }).changes ?? 0);
  if (changedCount > 0) {
    scheduleDriveSync("support_ticket");
    void flushDriveSync().catch((error) => {
      console.error(`[Telegram][Support] ticket #${ticketId} closed locally; asynchronous Drive synchronization failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return sendMessage(chatId, formatAdminTicketClosedMessage(ticketId), buildAdminKeyboard());
  }
  const ticket = (await db.select({ id: supportTickets.id, status: supportTickets.status }).from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1))[0];
  if (!ticket) {
    console.error(`[Telegram][Support] close ticket lookup failed: ticketId=${ticketId}; the ticket list may be from a different restored database instance`);
    return sendMessage(chatId, `⚠️ Support ticket #${ticketId} was not found in the active database. Refresh tickets and try again.`, buildAdminKeyboard());
  }
  return sendMessage(chatId, `ℹ️ Support ticket #${ticketId} is already ${ticket.status}.`, buildAdminKeyboard());
}

async function showAdminSettings(chatId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const rows = await db.select().from(botSettings).orderBy(botSettings.key);
  const configured = rows.length ? rows.map((row) => `• <code>${row.key}</code> = <code>${row.value.replace(/[<&>]/g, "")}</code>`).join("\\n") : "• No database overrides";
  return sendMessage(chatId, `<b>⚙️ Bot settings</b>\\n\\n${configured}\\n\\nPayment visibility: <code>${process.env.ENABLED_PAYMENT_OPTIONS ?? "all"}</code> or the persisted database override.\\n\\nUse <code>/setsetting payment_options wallet,binance,bep20,stars</code> or <code>/setsetting key value</code> for supported settings.`, buildAdminKeyboard());
}

async function setAdminSetting(chatId: number, text: string) {
  const match = text.match(/^\/setsetting(?:@[^\s]+)?\s+(\S+)\s+(.+)$/i);
  if (!match) return sendMessage(chatId, "Usage: <code>/setsetting &lt;key&gt; &lt;value&gt;</code>\\n\\nSupported: membership_channel_id, membership_group_id, membership_channel_url, membership_group_url, notification_chat_id, payment_options", buildAdminKeyboard());
  const key = match[1];
  const value = match[2].trim();
  const allowed = new Set(["membership_channel_id", "membership_group_id", "membership_channel_url", "membership_group_url", "notification_chat_id", "payment_options"]);
  if (!allowed.has(key)) return sendMessage(chatId, "⚠️ Unsupported setting key.", buildAdminKeyboard());
  if (key === "payment_options") {
    try { setRuntimePaymentOptions(value); } catch (error) { return sendMessage(chatId, `⚠️ ${String(error instanceof Error ? error.message : error)}`, buildAdminKeyboard()); }
  } else if (key.endsWith("_id") && !/^-?\d+$/.test(value)) return sendMessage(chatId, "⚠️ Chat IDs must contain only numbers, optionally prefixed with -.", buildAdminKeyboard());
  else if (key.endsWith("_url") && !validTelegramJoinUrl(value)) return sendMessage(chatId, "⚠️ Use a valid Telegram public or invite URL.", buildAdminKeyboard());
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.insert(botSettings).values({ key, value }).onConflictDoUpdate({ target: botSettings.key, set: { value } });
  scheduleDriveSync("wallet_balance");
  return sendMessage(chatId, `✅ Setting <code>${key}</code> updated.`, buildAdminKeyboard());
}

async function showAdminDiagnostics(chatId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const users = await db.select().from(botUsers).orderBy(desc(botUsers.updatedAt));
  const failures = await db.select({ botUserId: notificationDeliveries.botUserId, error: notificationDeliveries.error, createdAt: notificationDeliveries.createdAt }).from(notificationDeliveries).where(and(eq(notificationDeliveries.status, "failed"), isNull(notificationDeliveries.adminChatId))).orderBy(desc(notificationDeliveries.createdAt)).limit(500);
  const latest = new Map<number, string>();
  for (const failure of failures) if (failure.botUserId && !latest.has(failure.botUserId)) latest.set(failure.botUserId, telegramDeliveryFailureCategory(failure.error ?? "delivery failed"));
  const known = users.filter((user) => latest.has(user.id)).slice(0, 30).map((user) => `• <code>${user.telegramUserId}</code> ${user.username ? `@${user.username}` : "no username"} — ${latest.get(user.id)}`).join("\\n");
  return sendMessage(chatId, `<b>🔎 Telegram account diagnostics</b>\\n\\nTelegram does not provide a non-message API to scan every user for blocked/deleted status. The list below contains the latest known delivery failures from notifications/broadcasts.\\n\\n${known || "No known failed deliveries."}`, buildAdminKeyboard());
}

async function runAdminBroadcast(chatId: number, messageText: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const body = messageText.replace(/^\/broadcast(?:@[^\s]+)?\s*/i, "").trim();
  if (!body) return sendMessage(chatId, "Usage: <code>/broadcast your message</code>", buildAdminKeyboard());
  const inserted = await db.insert(broadcasts).values({ message: body, status: "sending" });
  const broadcastId = extractInsertedRowId(inserted);
  if (!broadcastId) throw new Error("Could not create broadcast record");
  const users = await db.select().from(botUsers);
  let sent = 0; let failed = 0; const failures: string[] = [];
  for (const user of users) {
    try {
      await sendMessage(user.telegramUserId, body);
      sent += 1;
      await db.insert(notificationDeliveries).values({ botUserId: user.id, eventType: "broadcast", referenceId: `${broadcastId}:${user.id}`, status: "sent", sentAt: new Date(), error: null }).onConflictDoUpdate({ target: [notificationDeliveries.eventType, notificationDeliveries.referenceId], set: { status: "sent", sentAt: new Date(), error: null } });
    } catch (error) {
      failed += 1;
      const reason = telegramDeliveryFailureCategory(error);
      failures.push(`• <code>${user.telegramUserId}</code> ${user.username ? `@${user.username}` : "no username"} — ${reason}`);
      await db.insert(notificationDeliveries).values({ botUserId: user.id, eventType: "broadcast", referenceId: `${broadcastId}:${user.id}`, status: "failed", error: reason }).onConflictDoUpdate({ target: [notificationDeliveries.eventType, notificationDeliveries.referenceId], set: { status: "failed", error: reason } });
    }
  }
  await db.update(broadcasts).set({ status: "completed", sentCount: sent, failedCount: failed, completedAt: new Date() }).where(eq(broadcasts.id, broadcastId));
  const failureReport = failures.length ? `\\n\\n<b>Failed recipients</b>\\n${failures.slice(0, 50).join("\\n")}` : "";
  return sendMessage(chatId, `✅ <b>Broadcast #${broadcastId} completed</b>\\n\\n📨 Sent: <b>${sent}</b>\\n❌ Failed: <b>${failed}</b>${failureReport}`, buildAdminKeyboard());
}

async function deleteAdminUser(chatId: number, text: string) {
  const match = text.match(/^\/deleteuser(?:@[^\s]+)?\s+(\d+)$/i);
  if (!match) return sendMessage(chatId, "Usage: <code>/deleteuser &lt;telegram-user-id&gt;</code>", buildAdminKeyboard());
  const telegramUserId = Number(match[1]);
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, telegramUserId)).limit(1))[0];
  if (!user) return sendMessage(chatId, "⚠️ No bot user exists with that Telegram ID.", buildAdminKeyboard());
  await db.transaction(async (tx) => {
    await tx.delete(supportTickets).where(eq(supportTickets.botUserId, user.id));
    await tx.delete(orders).where(eq(orders.botUserId, user.id));
    await tx.delete(walletLedger).where(eq(walletLedger.botUserId, user.id));
    await tx.delete(binancePayDeposits).where(eq(binancePayDeposits.botUserId, user.id));
    await tx.delete(paymentIntents).where(eq(paymentIntents.botUserId, user.id));
    await tx.delete(telegramStarsWalletPayments).where(eq(telegramStarsWalletPayments.botUserId, user.id));
    await tx.delete(freeClaims).where(eq(freeClaims.botUserId, user.id));
    await tx.delete(priceAlerts).where(eq(priceAlerts.botUserId, user.id));
    await tx.delete(notificationDeliveries).where(eq(notificationDeliveries.botUserId, user.id));
    await tx.delete(referrals).where(or(eq(referrals.referrerId, user.id), eq(referrals.referredUserId, user.id)));
    await tx.delete(botUsers).where(eq(botUsers.id, user.id));
  });
  scheduleDriveSync("wallet_balance");
  return sendMessage(chatId, `✅ Deleted bot user <code>${telegramUserId}</code> and associated data.`, buildAdminKeyboard());
}

async function handleAdminCommand(message: TelegramMessage) {
  if (!message.text || !isAuthorizedAdminMessage(message)) return false;
  const text = message.text.trim();
  const command = text.split(/\s+/)[0]?.toLowerCase().replace(/@[^\s]+$/, "");
  if (command === "/tickets") { await showAdminTickets(message.chat.id); return true; }
  if (command === "/close") {
    const ticketId = parseAdminCloseTicketCommand(text);
    if (!ticketId) { await sendMessage(message.chat.id, "Usage: <code>/close &lt;ticket-id&gt;</code>", buildAdminKeyboard()); return true; }
    await closeAdminTicket(message.chat.id, ticketId);
    return true;
  }
  if (command === "/settings") { await showAdminSettings(message.chat.id); return true; }
  if (command === "/setsetting") { await setAdminSetting(message.chat.id, text); return true; }
  if (command === "/diagnostics" || command === "/accountstatus") { await showAdminDiagnostics(message.chat.id); return true; }
  if (command === "/broadcast") { await runAdminBroadcast(message.chat.id, text); return true; }
  if (command === "/deleteuser") { await deleteAdminUser(message.chat.id, text); return true; }
  return false;
}

async function handleAdminReply(message: TelegramMessage) {
  const adminChatId = configuredAdminChatId();
  if (!isAuthorizedAdminMessage(message) || !adminChatId || !message.text) return false;
  const parsed = parseAdminReplyCommand(message.text);
  if (!parsed) return false;
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const ticketId = parsed.ticketId;
  const response = parsed.response;
  const ticket = (await db.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1))[0];
  if (!ticket) return sendMessage(adminChatId, `⚠️ Support ticket #${ticketId} was not found.`).then(() => true);
  const user = (await db.select().from(botUsers).where(eq(botUsers.id, ticket.botUserId)).limit(1))[0];
  if (!user) return sendMessage(adminChatId, `⚠️ The user for support ticket #${ticketId} was not found.`).then(() => true);
  await sendMessage(user.telegramUserId, `💬 <b>Support reply for ticket #${ticketId}</b>\n\n${response}`);
  await db.update(supportTickets).set({ status: "answered", adminReply: response, repliedAt: new Date(), updatedAt: new Date() }).where(eq(supportTickets.id, ticketId));
  scheduleDriveSync("support_ticket");
  await sendMessage(adminChatId, `✅ Reply sent to the user for ticket #${ticketId}.`);
  return true;
}

export function normalizeWarrantyText(value: string | number | null | undefined): string {
  if (typeof value === "number") return value > 0 ? `${value} days` : "";
  return typeof value === "string" ? value.trim() : "";
}

export function formatPurchaseConfirmation(orderId: string | number, productName: string, amountCents: number, delivery?: { mode: "automatic" | "manual"; items?: string[]; warrantyDays?: string | number }) {
  const warrantyText = normalizeWarrantyText(delivery?.warrantyDays);
  const warranty = warrantyText ? `\n🛡️ Warranty: <b>${warrantyText.replace(/[<&>]/g, "")}</b>` : "";
  const delivered = delivery?.items?.length
    ? `\n\n📦 <b>${delivery.mode === "manual" ? "Manual delivery details" : "Your digital product"}</b>\n<blockquote>${delivery.items.map(item => item.replace(/[<&>]/g, "")).join("\n")}</blockquote>\n\n${delivery.mode === "manual" ? "🕐 This is a manual-delivery product. Follow the instructions above; the order is recorded as completed." : "Tap and hold the text above to copy it."}${warranty}`
    : delivery?.mode === "manual"
      ? `\n\n🕐 <b>Manual delivery</b>\nYour order is recorded as completed. Follow the product instructions or contact support if the admin provided no details.${warranty}`
      : warranty;
  return `✅ <b>Order completed</b>\n\n📦 Order: <b>#${orderId}</b>\n🛍️ Product: <b>${productName}</b>\n💵 Amount: <b>$${(amountCents / 100).toFixed(2)}</b>${delivered}\n\n⚡ Payment received and your order is complete.`;
}

export function consumeDigitalInventory(inventoryText: string | null | undefined, quantity: number) {
  const items = String(inventoryText ?? "").replaceAll("\\n", "\n").split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  const count = Math.max(1, Math.floor(quantity));
  if (items.length < count) return { ok: false as const, items: [] as string[], remaining: items };
  return { ok: true as const, items: items.slice(0, count), remaining: items.slice(count) };
}


export function formatShopSummary(page: number, pageCount: number) {
  const pagination = pageCount > 1 ? `\n\n📄 Page ${page + 1} of ${pageCount}` : "";
  return `🛍️ <b>ToolsMania Shop</b>\n\nChoose a product to view its details and buy instantly.${pagination}`;
}

export function formatOrderStatus(orderId: string | number, kind: string, status: string, amountCents: number) {
  const icon = status === "fulfilled" ? "✅" : status === "cancelled" ? "❌" : "⏳";
  return `${icon} #${orderId} · ${kind} · ${status} · $${(amountCents / 100).toFixed(2)}`;
}

export function formatDetailedOrder(order: { id: string | number; kind: string; status: string; amountCents: number; productName: string; deliveredItem?: string | null; paymentMethod?: string | null; quantity?: number | null; purchaseWarranty?: string | null; createdAt: Date | string }) {
  const icon = order.status === "fulfilled" ? "✅" : order.status === "cancelled" ? "❌" : "⏳";
  const purchasedAt = new Date(order.createdAt).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const product = order.productName.replace(/[<&>]/g, "");
  const quantity = Number(order.quantity ?? 1);
  const delivered = order.deliveredItem?.trim() ? `\n📦 <b>Delivery details</b>\n<pre>${order.deliveredItem.trim().replace(/[<&>]/g, "")}</pre>` : "\n📦 <b>Delivery details:</b> No stock text was stored for this order.";
  const payment = (order.paymentMethod ?? (order.amountCents > 0 ? "Payment method unavailable" : "Free / credits")).replace(/[<&>]/g, "");
  const warranty = order.purchaseWarranty?.trim() ? `\n🛡️ Warranty: <b>${order.purchaseWarranty.trim().replace(/[<&>]/g, "")}</b>` : "";
  return `${icon} <b>Order #${order.id}</b>\n🛍️ Product: <b>${product}</b>\n🔢 Quantity: <b>${quantity}</b>\n💵 Total paid: <b>$${(order.amountCents / 100).toFixed(2)}</b>\n💳 Payment: <b>${payment}</b>\n🗓️ Purchased: <b>${purchasedAt}</b>\n📌 Status: <b>${order.status}</b>${warranty}${delivered}`;
}

export function maskPurchaseName(name: string | undefined, telegramUserId?: number) {
  const raw = (name ?? "User").replace(/[<>]/g, "").trim() || "User";
  const firstCharacter = Array.from(raw)[0] ?? "U";
  return `${firstCharacter}*****`;
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
  const botUrl = `https://t.me/${PUBLIC_BOT_USERNAME}?start=product_${productId}`;
  return {
    text: `🛍️ <b>ToolsMania</b>\n\n👤 <b>${maskedName}</b> just bought <b>${quantity}×</b> ${productEmoji(productName)} <b>${productName.replace(/[<>]/g, "")}</b>!`,
    replyMarkup: { inline_keyboard: [[{ text: "🛍️ View product in bot", url: botUrl, style: "primary" }]] },
  };
}

export function formatReferralRewardNotification(productName: string, credits: number, userName?: string, telegramUserId?: number) {
  return `<b>Referral reward redeemed</b>\n👤 User: <b>${maskPurchaseName(userName, telegramUserId)}</b>\n🎁 Product: <b>${productName.replace(/[<&>]/g, "")}</b>\n🎟️ Credits used: <b>${credits}</b>`;
}
export function formatQualifiedReferralNotification(referrerName: string | undefined, referrerId: number, invitedName: string | undefined, invitedId: number) {
  return `<b>New qualified referral</b>\n👤 Referrer: <b>${maskPurchaseName(referrerName, referrerId)}</b>\n👤 New member: <b>${maskPurchaseName(invitedName, invitedId)}</b>\n🎟️ Credit awarded: <b>1</b>`;
}
export function buildQualifiedReferralNotificationKeyboard() {
  return keyboard([[{ text: "🔗 Get your referral link", url: `https://t.me/${PUBLIC_BOT_USERNAME}?start=referrals` }]]);
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
  await db.insert(notificationDeliveries).values({ adminChatId: targetChatId, eventType, referenceId, status: "queued" }).onConflictDoUpdate({ target: [notificationDeliveries.eventType, notificationDeliveries.referenceId], set: { status: "queued" } });
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

type TelegramButton = { text: string; callback_data?: string; url?: string; web_app?: { url: string }; copy_text?: { text: string }; style?: "danger" | "success" | "primary" };

function keyboard(rows: Array<Array<TelegramButton>>) {
  return { inline_keyboard: rows };
}

export function buildHomeKeyboard() {
  return keyboard([
    [{ text: "🛍️ Shop", callback_data: "shop", style: "primary" }],
    [{ text: "👤 My Profile", callback_data: "profile", style: "success" }, { text: "💰 Deposit", callback_data: "wallet", style: "success" }],
    [{ text: "🛠️ Developer API", callback_data: "developer_api", style: "success" }],
    [{ text: "🆘 Support", callback_data: "support", style: "success" }],
    [{ text: "⭐ Refer & Earn", callback_data: "referrals", style: "success" }],
  ]);
}

export function buildMembershipKeyboard(channelUrl: string, groupUrl: string) {
  return keyboard([
    [{ text: "📣 Join Updates Channel", url: channelUrl, style: "success" }],
    [{ text: "👥 Join Community Group", url: groupUrl, style: "success" }],
    [{ text: "✅ I have joined", callback_data: "verify_membership", style: "primary" }],
  ]);
}

export function buildShopKeyboard(items: Array<{ id: number; name: string; priceCents: number; stock?: number }>, page = 0, pageCount = 1) {
  const rows: TelegramButton[][] = items.map((item) => {
    const stock = Number(item.stock ?? 0);
    const available = stock > 0;
    const label = available ? `✨ ${item.name} · $${(item.priceCents / 100).toFixed(2)} (${stock})` : `⛔ ${item.name} · OUT OF STOCK (0)`;
    return [{ text: label.slice(0, 64), callback_data: `product:${item.id}`, style: available ? "primary" : "danger" }];
  });
  rows.push([{ text: "🔄 Refresh", callback_data: "shop:0", style: "success" }, { text: "🏠 Back to home", callback_data: "home", style: "success" }]);
  return keyboard(rows);
}

export function buildWalletKeyboard() {
  return keyboard([
    [{ text: paymentButtonLabel("➕ Add funds with Binance Pay (USDT)", "binance_pay"), callback_data: "walletadd", style: "success" }],
    [{ text: paymentButtonLabel("➕ Add funds with USDT (BEP20)", "bep20"), callback_data: "walletbep20", style: "primary" }],
    [{ text: paymentButtonLabel("⭐ Add funds with Telegram Stars", "telegram_stars"), callback_data: "walletstars", style: "primary" }],
    [{ text: "🏠 Back to home", callback_data: "home", style: "primary" }],
  ]);
}

export function buildWalletDepositAmountKeyboard() {
  return keyboard([[{ text: "✖️ Cancel", callback_data: "walletcancel" }]]);
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

export function buildCustomQuantityKeyboard(productId: number) {
  return keyboard([[{ text: "✖️ Cancel", callback_data: `buycancel:${productId}` }]]);
}

export function buildPaymentMethodKeyboard(productId: number, quantity: number) {
  return keyboard([
    [{ text: paymentButtonLabel("💳 Pay with Wallet", "wallet"), callback_data: `paywallet:${productId}:${quantity}`, style: "success" }],
    [{ text: paymentButtonLabel("🟡 Pay with Binance Pay (USDT)", "binance_pay"), callback_data: `paybinance:${productId}:${quantity}`, style: "primary" }],
    [{ text: paymentButtonLabel("🟢 Pay with USDT (BEP20)", "bep20"), callback_data: `paybep20:${productId}:${quantity}`, style: "primary" }],
    [{ text: paymentButtonLabel("⭐ Pay with Telegram Stars", "telegram_stars"), callback_data: `paystars:${productId}:${quantity}`, style: "primary" }],
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

export function formatPurchaseReview(productName: string, basePriceCents: number, quantity: number, balanceCents: number, bulkPricing?: string | null) {
  const unitPriceCents = resolveBulkUnitPriceCents(basePriceCents, bulkPricing, quantity);
  const totalCents = unitPriceCents * quantity;
  const discountNote = unitPriceCents !== basePriceCents ? `\n🏷️ Bulk price applied for ${quantity} units` : "";
  return `🧾 <b>Review your purchase</b>\n\n📦 <b>${productName.replace(/[<&>]/g, "")}</b>\n🔢 Quantity: <b>${quantity}</b>\n💵 Unit price: <b>$${(unitPriceCents / 100).toFixed(2)}</b>${discountNote}\n💰 Total to pay: <b>$${(totalCents / 100).toFixed(2)}</b>\n\nWallet balance: <b>$${(balanceCents / 100).toFixed(2)}</b>\n\nChoose a payment method below. Your order is not completed until the selected payment is verified.`;
}

export function merchantBinanceId() {
  return (process.env.BID ?? "").trim() || "Binance Pay ID is not configured yet";
}

export function bep20DepositAddress() {
  return (process.env.BEP20 ?? "").trim() || "BEP20 address is not configured yet";
}

export function formatBinancePayPurchasePrompt(productName: string, quantity: number, amountCents: number) {
  const amount = `$${(amountCents / 100).toFixed(2)}`;
  return `🟡 <b>Pay with Binance Pay (USDT)</b>\n\n📦 ${productName.replace(/[<&>]/g, "")} × ${quantity}\n💰 <b>Amount to send:</b> ${amount} USDT\n💳 <b>Binance Pay ID:</b> <code>${merchantBinanceId()}</code>\n━━━━━━━━━━━━━━━━━━\n\n<b>How to pay:</b>\n1. Open Binance → Pay → Send.\n2. Recipient: paste the Binance Pay ID above.\n3. Send the exact amount shown in USDT.\n4. Copy your Transaction ID from Binance Pay → History.\n5. Send the Transaction ID here as your next message.\n\nThis invoice expires in <b>20 minutes</b>.`;
}

export function formatBep20PurchasePrompt(productName: string, quantity: number, amountCents: number) {
  const amount = `$${(amountCents / 100).toFixed(2)}`;
  return `🟢 <b>Pay with USDT (BEP20)</b>\n\n📦 ${productName.replace(/[<&>]/g, "")} × ${quantity}\n💰 <b>Amount to send:</b> ${amount} USDT\n💳 <b>Deposit address (BEP20):</b> <code>${bep20DepositAddress()}</code>\n━━━━━━━━━━━━━━━━━━\n\n<b>Important:</b>\n• Create this invoice before sending any funds.\n• Send exactly ${amount} USDT — no more and no less.\n• Use the BEP20 network only — wrong-network funds are unrecoverable.\n• After sending, send the Transaction Hash (TxID) here as your next message.\n\nThis invoice expires in <b>30 minutes</b>. Transfers made before this invoice was created or after expiry are not accepted.`;
}

export function formatBinancePayTopupPrompt(amountCents: number) {
  const amount = `$${(amountCents / 100).toFixed(2)}`;
  return `💰 <b>Amount to send:</b> ${amount} USDT\n💳 <b>Binance Pay ID:</b> <code>${merchantBinanceId()}</code>\n━━━━━━━━━━━━━━━━━━\n\n<b>How to pay:</b>\n1. Open Binance → Pay → Send.\n2. Recipient: paste the Binance Pay ID above.\n3. Send the exact amount shown in USDT.\n4. Copy your Transaction ID from Binance Pay → History.\n5. Send the Transaction ID here as your next message.\n\nThis invoice expires in <b>20 minutes</b>.`;
}

export function formatBep20TopupPrompt(amountCents: number) {
  const amount = `$${(amountCents / 100).toFixed(2)}`;
  return `💰 <b>Amount to send:</b> ${amount} USDT\n💳 <b>Deposit address (BEP20):</b> <code>${bep20DepositAddress()}</code>\n━━━━━━━━━━━━━━━━━━\n\n<b>Important:</b>\n• Send the exact amount shown.\n• Use the BEP20 network only — wrong-network funds are unrecoverable.\n• After sending, send the Transaction Hash (TxID) here as your next message.\n\nThis invoice expires in <b>20 minutes</b>.`;
}

export function formatTelegramStarsTopupPrompt(amountCents: number, stars: number) {
  const amount = `$${(amountCents / 100).toFixed(2)}`;
  return `⭐ <b>Telegram Stars wallet deposit</b>\n\n💰 Wallet credit: <b>${amount}</b>\n⭐ Price: <b>${stars} Telegram Stars</b>\n\nTap the payment button below to complete the deposit. Your wallet is credited only after Telegram confirms the payment.`;
}

export function buildPurchasePaymentFailureKeyboard(productId: number) {
  return keyboard([[{ text: "✖️ Cancel", callback_data: `buycancel:${productId}` }]]);
}

export function formatPaymentVerificationFailure(reason: string, method: "binance_pay" | "bep20", expectedAmountCents?: number) {
  const isBep20 = method === "bep20";
  const expected = expectedAmountCents === undefined ? "the exact requested amount" : `$${(expectedAmountCents / 100).toFixed(2)}`;
  if (reason === "invalid_id") return isBep20 ? "That does not look like a valid transaction hash (TxID)." : "That does not look like a valid Binance Pay order ID.";
  if (reason === "not_found") return isBep20 ? "I could not find that USDT BEP20 deposit yet. Confirm the TxID and wait a moment for network confirmation." : "I could not find that Binance Pay payment yet.";
  if (reason === "amount_mismatch") return `The payment amount must be within $0.03 of the requested ${expected}.`;
  if (reason === "unsupported_asset") return isBep20 ? "Only USDT deposits on the BEP20 network can be verified." : "Only the supported Binance Pay USDT payment can be verified.";
  if (reason === "unsupported_network") return "The deposit was not sent through the BEP20 network.";
  if (reason === "address_mismatch") return "The deposit was sent to a different address than the configured BEP20 address.";
  if (reason === "before_invoice") return "This transfer was made before the matching invoice was created. Create a new invoice first, then send the requested amount within the allowed $0.03 range.";
  if (reason === "stale_transaction") return isBep20 ? "This BEP20 transaction is outside the active invoice window or has no usable timestamp." : "This Binance Pay transaction is older than 12 hours or has no usable timestamp. Send a newer payment ID.";
  return isBep20 ? "That is not a positive received USDT BEP20 deposit." : "That is not a positive received Binance Pay payment.";
}

export function formatTopupVerificationFailure(reason: string, method: "binance_pay" | "bep20") {
  const isBep20 = method === "bep20";
  const identifierLabel = isBep20 ? "transaction hash (TxID)" : "Binance Pay order ID";
  const retryLabel = isBep20 ? "Wallet → USDT (BEP20)" : "Wallet → Binance Pay";
  return `❌ <b>Top-up not credited</b>\n\n${formatPaymentVerificationFailure(reason, method)}\n\nCheck the ${identifierLabel} and try again from ${retryLabel} with an amount within the allowed $0.03 range.`;
}

export function buildWalletDepositInvoiceKeyboard(method: "binance_pay" | "bep20" = "binance_pay") {
  const value = method === "bep20" ? bep20DepositAddress() : merchantBinanceId();
  const label = method === "bep20" ? "📋 Copy BEP20 address" : "📋 Copy Binance Pay ID";
  return keyboard([[{ text: label, copy_text: { text: value } }], [{ text: "✖️ Cancel", callback_data: "walletcancel" }]]);
}

export function buildTelegramStarsTopupKeyboard() {
  return keyboard([[{ text: "⭐ Pay with Telegram Stars", callback_data: "walletstars_pay" }], [{ text: "✖️ Cancel", callback_data: "walletcancel" }]]);
}

export function formatWalletDepositAmountPrompt(error?: "invalid" | "range", method: "binance_pay" | "bep20" | "telegram_stars" = "binance_pay") {
  const notice = error === "invalid" ? "⚠️ Enter a valid USD amount, for example <b>10</b> or <b>10.50</b>.\n\n" : error === "range" ? "⚠️ Enter an amount from <b>$0.01</b> to <b>$1,000.00</b>.\n\n" : "";
  const title = method === "bep20" ? "🟢 <b>Add funds with USDT (BEP20)</b>" : method === "telegram_stars" ? "⭐ <b>Add funds with Telegram Stars</b>\n\nFixed rate: <b>100 Stars = $1.20</b>" : "💳 <b>Add funds with Binance Pay (USDT)</b>";
  return `${notice}${title}\n\nEnter the amount in USD you want to add.\n\nExample: <b>10</b> for $10.00`;
}

export function parseUsdAmountInput(text: string) {
  const value = text.trim().replace(/^\$/, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return { ok: false as const, reason: "invalid" as const };
  const amountCents = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 100_000) return { ok: false as const, reason: "range" as const };
  return { ok: true as const, amountCents };
}

async function runtimeGate() {
  const db = await getDb();
  if (!db) return { channelId: DEFAULT_CHANNEL_ID, groupId: DEFAULT_GROUP_ID, channelUrl: DEFAULT_CHANNEL_URL, groupUrl: DEFAULT_GROUP_URL };
  const rows = await db.select().from(botSettings).where(sql`\`key\` in ('membership_channel_id', 'membership_group_id', 'membership_channel_url', 'membership_group_url', 'notification_chat_id', 'payment_options')`);
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  if (values.payment_options) {
    try { setRuntimePaymentOptions(values.payment_options); } catch (error) { console.warn("[Telegram] Ignoring invalid persisted payment_options", error); }
  }
  return {
    channelId: values.membership_channel_id || DEFAULT_CHANNEL_ID,
    groupId: values.membership_group_id || DEFAULT_GROUP_ID,
    channelUrl: values.membership_channel_url || DEFAULT_CHANNEL_URL,
    groupUrl: values.membership_group_url || DEFAULT_GROUP_URL,
    notificationChatId: values.notification_chat_id || DEFAULT_GROUP_ID,
  };
}

export function isTelegramChatNotFoundError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /chat not found|group chat was upgraded to a supergroup/i.test(message);
}

const MEMBERSHIP_CACHE_TTL_MS = 60_000;
const membershipCache = new Map<number, { expiresAt: number; status: Awaited<ReturnType<typeof membershipStatusInternal>> }>();

async function membershipStatusInternal(userId: number) {
  const gate = await runtimeGate();
  try {
    const [channel, group] = await Promise.all([
      telegramCall<{ status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked" }>("getChatMember", { chat_id: gate.channelId, user_id: userId }),
      telegramCall<{ status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked" }>("getChatMember", { chat_id: gate.groupId, user_id: userId }),
    ]);
    return { channel: channel.status, group: group.status, access: hasAccess(channel.status, group.status) };
  } catch (error) {
    if (!isTelegramChatNotFoundError(error) && !isTelegramTransientNetworkError(error)) throw error;
    // A deleted, migrated, mistyped, or temporarily unreachable gate chat must not
    // make /start completely silent. Valid Telegram member statuses remain strict;
    // this fail-open path keeps the bot usable while the owner repairs configuration
    // or Telegram connectivity recovers.
    const reason = isTelegramChatNotFoundError(error) ? "invalid membership chat" : "temporary Telegram connectivity failure";
    console.warn(`[Telegram] Membership gate unavailable (${reason}); allowing bot access temporarily.`, { channelId: gate.channelId, groupId: gate.groupId });
    return { channel: "left" as const, group: "left" as const, access: true };
  }
}

async function membershipStatus(userId: number, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh) {
    const cached = membershipCache.get(userId);
    if (cached && cached.expiresAt > now) return cached.status;
    if (cached) membershipCache.delete(userId);
  }
  const status = await membershipStatusInternal(userId);
  if (status.access || status.channel !== "left" || status.group !== "left") {
    membershipCache.set(userId, { expiresAt: now + MEMBERSHIP_CACHE_TTL_MS, status });
  }
  return status;
}

export function clearMembershipCache(userId?: number) {
  if (userId === undefined) membershipCache.clear();
  else membershipCache.delete(userId);
}

async function recordBotActivityById(botUserId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(botUsers).set({ updatedAt: new Date() }).where(eq(botUsers.id, botUserId));
}
async function recordBotActivity(telegramUserId: number) {
  const db = await getDb();
  if (!db) return;
  const user = (await db.select({ id: botUsers.id }).from(botUsers).where(eq(botUsers.telegramUserId, telegramUserId)).limit(1))[0];
  if (user) await recordBotActivityById(user.id);
}

async function ensureBotUser(user: TelegramUser, referralCode?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const existing = await db.select().from(botUsers).where(eq(botUsers.telegramUserId, user.id)).limit(1);
  if (existing[0]) {
    const nextIdentity = { username: user.username ?? null, firstName: user.first_name ?? null, lastName: user.last_name ?? null };
    const current = existing[0];
    if (current.username !== nextIdentity.username || current.firstName !== nextIdentity.firstName || current.lastName !== nextIdentity.lastName) {
      await db.update(botUsers).set(nextIdentity).where(eq(botUsers.id, existing[0].id));
    }
    return existing[0];
  }
  let referredById: number | null = null;
  if (referralCode) {
    const referrer = await db.select().from(botUsers).where(eq(botUsers.referralCode, referralCode)).limit(1);
    referredById = referrer[0] && referrer[0].telegramUserId !== user.id ? referrer[0].id : null;
  }
  const referralCodeForUser = referralCodeForTelegramId(user.id);
  await db.insert(botUsers).values({ telegramUserId: user.id, username: user.username ?? null, firstName: user.first_name ?? null, lastName: user.last_name ?? null, referralCode: referralCodeForUser, referredById, balanceCents: TESTING_WALLET_CREDIT_CENTS });
  const created = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, user.id)).limit(1))[0];
  if (!created) throw new Error("Failed to create Telegram user");
  scheduleDriveSync("new_user");
  // Do not create a synthetic ledger entry: new users start at exactly $0.00.
  // Referral rows and credits are awarded only after both membership checks pass.
  return created;
}

async function qualifyReferralIfEligible(userId: number) {
  const db = await getDb();
  if (!db) return false;
  const invited = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  if (!invited?.referredById) return false;
  const status = await membershipStatus(userId);
  if (!status.access) return false;
  const existing = (await db.select().from(referrals).where(eq(referrals.referredUserId, invited.id)).limit(1))[0];
  if (existing) return false;
  const referrer = (await db.select().from(botUsers).where(eq(botUsers.id, invited.referredById)).limit(1))[0];
  if (!referrer) return false;
  const inserted = await db.insert(referrals).values({ referrerId: referrer.id, referredUserId: invited.id, bonusCents: 0, creditsAwarded: 1 }).onConflictDoNothing();
  if (!didInsertReferralRow(inserted)) return false;
  await db.update(botUsers).set({ referralCredits: sql`${botUsers.referralCredits} + 1` }).where(eq(botUsers.id, referrer.id));
  const referralCount = await db.select({ count: sql<number>`count(*)` }).from(referrals).where(eq(referrals.referrerId, referrer.id));
  await db.update(botUsers).set({ tier: tierForReferralCount(Number(referralCount[0]?.count ?? 0)) }).where(eq(botUsers.id, referrer.id));
  scheduleDriveSync("referral_update");
  await notifyAdmin("referral_qualified", String(invited.id), formatQualifiedReferralNotification(referrer.firstName ?? referrer.username ?? undefined, referrer.telegramUserId, invited.firstName ?? invited.username ?? undefined, invited.telegramUserId), buildQualifiedReferralNotificationKeyboard());
  return true;
}
async function requireAccess(chatId: number, userId: number, messageId?: number) {
  const status = await membershipStatus(userId);
  if (status.access) {
    await qualifyReferralIfEligible(userId);
    return true;
  }
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
  const spentRows = await db.select({ total: sql<number>`coalesce(sum(${orders.amountCents}), 0)` }).from(orders).where(eq(orders.botUserId, user?.id ?? -1));
  const status = await membershipStatus(userId);
  await respond(chatId, formatHomeMessage({
    firstName: user?.firstName,
    username: user?.username,
    tier: user?.tier,
    balanceCents: user?.balanceCents,
    totalSpentCents: Number(spentRows[0]?.total ?? 0),
    referrals: Number(referralRows[0]?.count ?? 0),
    access: status.access,
  }), buildHomeKeyboard(), messageId);
}

export function isPurchasableProduct(product: { active: number | boolean; stock: number; hidden?: number | boolean } | undefined) {
  return Boolean(product && (product.active === 1 || product.active === true) && !(product.hidden === 1 || product.hidden === true) && product.stock > 0);
}

export function isShopEligibleProduct(product: { active: number | boolean; shopEligible?: number | boolean; hidden?: number | boolean } | undefined) {
  return Boolean(product && (product.active === 1 || product.active === true) && !(product.hidden === 1 || product.hidden === true) && (product.shopEligible === undefined || product.shopEligible === 1 || product.shopEligible === true));
}

async function showBotInfo(chatId: number, messageId?: number, admin = false) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const userRows = await db.select({ count: sql<number>`count(*)` }).from(botUsers);
  const orderRows = await db.select({ count: sql<number>`count(*)` }).from(orders).where(or(eq(orders.status, "fulfilled"), eq(orders.status, "paid")));
  return respond(chatId, formatBotInfoMessage(Number(userRows[0]?.count ?? 0), Number(orderRows[0]?.count ?? 0)), admin ? buildAdminKeyboard() : buildHomeKeyboard(), messageId);
}

async function showShop(chatId: number, page = 0, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const items = await db.select().from(products).where(and(eq(products.active, 1), or(eq(products.shopEligible, 1), isNull(products.shopEligible)), or(eq(products.hidden, 0), isNull(products.hidden))));
  const sortSetting = (await db.select().from(botSettings).where(eq(botSettings.key, "catalog_sort")).limit(1))[0]?.value?.trim().toLowerCase();
  if (sortSetting === "most_sold") {
    const soldRows = await db.select({ productId: orders.productId, total: sql<number>`coalesce(sum(${orders.quantity}), 0)` }).from(orders).where(or(eq(orders.status, "fulfilled"), eq(orders.status, "paid"))).groupBy(orders.productId);
    const soldByProduct = new Map(soldRows.map((row) => [row.productId, Number(row.total ?? 0)]));
    items.sort((a, b) => (soldByProduct.get(b.id) ?? 0) - (soldByProduct.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  } else items.sort((a, b) => a.name.localeCompare(b.name));
  if (!items.length) return respond(chatId, "🛍️ <b>Shop</b>\n\nThe catalog is empty right now. Please check back soon.", undefined, messageId);
  await respond(chatId, formatShopSummary(0, 1), buildShopKeyboard(items, 0, 1), messageId);
}

async function showProduct(chatId: number, productId: number, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const item = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!isPurchasableProduct(item)) return respond(chatId, "⚠️ This product is currently unavailable.\n\nThis may be an old product button. Open the current Shop to see items that are in stock.", buildUnavailableProductKeyboard(), messageId);
  const soldRows = await db.select({ total: sql<number>`coalesce(sum(${orders.quantity}), 0)` }).from(orders).where(and(eq(orders.productId, productId), or(eq(orders.status, "fulfilled"), eq(orders.status, "paid"))));
  const soldCount = Number(soldRows[0]?.total ?? 0);
  const bulkText = formatBulkPricingForUsers(item.bulkPricing, item.stock);
  const bulk = bulkText ? `\n\n📊 <b>Bulk pricing</b>\n${bulkText}` : "";
  const safeName = item.name.replace(/[<&>]/g, "");
  const safeDescription = item.description.replace(/[<&>]/g, "");
  const deliveryFormatText = typeof item.deliveryFormat === "string" ? item.deliveryFormat.trim() : String(item.deliveryFormat ?? "").trim();
  const deliveryFormat = deliveryFormatText ? `\n\n📋 <b>Delivery format</b>\n${deliveryFormatText.replace(/[<&>]/g, "")}` : "";
  const delivery = item.deliveryMode === "manual" ? "🕐 Manual delivery" : "⚡ Automatic digital delivery";
  const warrantyText = normalizeWarrantyText(item.warrantyDays);
  const warranty = warrantyText ? `\n🛡️ Warranty: <b>${warrantyText.replace(/[<&>]/g, "")}</b>` : "";
  const productText = `✨ <b>${safeName}</b>\n\n${safeDescription}${deliveryFormat}\n\n━━━━━━━━━━━━━━\n💵 <b>$${(item.priceCents / 100).toFixed(2)}</b> per unit\n📦 <b>${item.stock}</b> available\n🛒 Sold: <b>${soldCount}</b>\n${delivery}${warranty}${bulk}\n\nChoose an action below:`;
  const productKeyboard = buildProductKeyboard(item.id);
  if (hasProductImage(item.imageUrl)) {
    try {
      if (isHttpProductImageUrl(item.imageUrl)) {
        await sendPhotoUpload(chatId, item.imageUrl.trim(), productText, productKeyboard);
      } else {
        await sendPhoto(chatId, item.imageUrl.trim(), productText, productKeyboard);
      }
      return;
    } catch (error) {
      console.error("[Telegram] product image failed; falling back to text product view", error);
    }
  }
  await respond(chatId, productText, productKeyboard, messageId);
}

async function showWallet(chatId: number, userId: number, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const ledger = await db.select().from(walletLedger).where(eq(walletLedger.botUserId, user?.id ?? -1)).orderBy(desc(walletLedger.createdAt)).limit(1000);
  const history = ledger.length ? ledger.map((entry) => `${entry.amountCents >= 0 ? "+" : ""}$${(entry.amountCents / 100).toFixed(2)} — ${entry.kind}`).join("\n") : "No ledger activity yet.";
  await respond(chatId, `💳 <b>Wallet</b>\n\n💰 Balance: $${((user?.balanceCents ?? 0) / 100).toFixed(2)}\n\n📒 <b>Recent activity</b>\n${history}`, buildWalletKeyboard(), messageId);
}

const ORDERS_PAGE_SIZE = 5;

function orderProductButtonLabel(orderId: string | number, productName: string) {
  const safe = productName.replace(/[<&>]/g, "");
  return `#${orderId} · ${safe}`.slice(0, 64);
}

export function buildOrdersKeyboard(rows: Array<{ id: string | number; productName: string }>, page: number, pageCount: number) {
  const buttons = rows.map((order) => [{ text: orderProductButtonLabel(order.id, order.productName), callback_data: `order_detail:${order.id}:${page}` }]);
  const navigation: Array<{ text: string; callback_data: string }> = [];
  if (page > 0) navigation.push({ text: "⬅️ Newer orders", callback_data: `orders_page:${page - 1}` });
  if (page < pageCount - 1) navigation.push({ text: "➡️ Older orders", callback_data: `orders_page:${page + 1}` });
  if (navigation.length) buttons.push(navigation);
  buttons.push([{ text: "⌂ Home", callback_data: "home" }]);
  return keyboard(buttons);
}

export function buildOrderDetailKeyboard(orderId: string | number, page: number) {
  return keyboard([[{ text: "🛒 Buy again", callback_data: `order_buy_again:${orderId}` }], [{ text: "↩️ Back to orders", callback_data: `orders_page:${page}` }], [{ text: "⌂ Home", callback_data: "home" }]]);
}

async function loadUserOrder(chatId: number, userId: number, orderId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const order = user ? (await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.botUserId, user.id), or(eq(orders.status, "fulfilled"), eq(orders.status, "paid")))).limit(1))[0] : undefined;
  if (!order) return { db, user, order: undefined, product: undefined };
  const product = (await db.select().from(products).where(eq(products.id, order.productId)).limit(1))[0];
  return { db, user, order, product };
}

async function showOrders(chatId: number, userId: number, messageId?: number, page = 0) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const userIdValue = user?.id ?? -1;
  const countRows = await db.select({ count: sql<number>`count(*)` }).from(orders).where(and(eq(orders.botUserId, userIdValue), or(eq(orders.status, "fulfilled"), eq(orders.status, "paid"))));
  const total = Number(countRows[0]?.count ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);
  const rows = await db.select().from(orders).where(and(eq(orders.botUserId, userIdValue), or(eq(orders.status, "fulfilled"), eq(orders.status, "paid")))).orderBy(desc(orders.createdAt)).limit(ORDERS_PAGE_SIZE).offset(safePage * ORDERS_PAGE_SIZE);
  const productIds = Array.from(new Set(rows.map((row) => row.productId).filter((id): id is number => typeof id === "number")));
  const productRows = productIds.length ? await db.select().from(products).where(inArray(products.id, productIds)) : [];
  const productById = new Map(productRows.map((product) => [product.id, product.name]));
  const buttonRows = rows.map((order) => ({ id: order.id, productName: productById.get(order.productId) ?? `Product #${order.productId}` }));
  const text = total ? `📦 <b>Completed orders</b>\n\nChoose an order to view its full details and delivery information.\n\nPage <b>${safePage + 1}</b> of <b>${pageCount}</b>\nMost recent orders are shown first.` : "📦 <b>Completed orders</b>\n\nYou do not have any completed orders yet.";
  await respond(chatId, text, buildOrdersKeyboard(buttonRows, safePage, pageCount), messageId);
}

async function showOrderDetails(chatId: number, userId: number, orderId: number, page: number, messageId?: number) {
  const loaded = await loadUserOrder(chatId, userId, orderId);
  if (!loaded.order) return respond(chatId, "⚠️ This completed order could not be found in your account.", buildOrdersKeyboard([], page, 1), messageId);
  const productName = loaded.product?.name ?? `Product #${loaded.order.productId}`;
  const details = formatDetailedOrder({ ...loaded.order, productName });
  await respond(chatId, `📦 <b>Order details</b>\n\n${details}`, buildOrderDetailKeyboard(orderId, page), messageId);
}

async function buyAgainFromOrder(chatId: number, userId: number, orderId: number, messageId?: number) {
  const loaded = await loadUserOrder(chatId, userId, orderId);
  if (!loaded.order || !loaded.product || !isPurchasableProduct(loaded.product)) return respond(chatId, "⚠️ This product is no longer available for purchase.", buildHomeKeyboard(), messageId);
  return showQuantityPrompt(chatId, loaded.product.id, messageId);
}

async function showProfile(chatId: number, userId: number, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const referralsCount = await db.select({ count: sql<number>`count(*)` }).from(referrals).where(eq(referrals.referrerId, user?.id ?? -1));
  const spentRows = await db.select({ total: sql<number>`coalesce(sum(${orders.amountCents}), 0)` }).from(orders).where(eq(orders.botUserId, user?.id ?? -1));
  await respond(chatId, `👤 <b>Profile</b>\n\n🪪 Name: ${user?.firstName ?? "User"}\n🏅 Tier: ${user?.tier ?? "Bronze"}\n💰 Total spent: <b>$${(Number(spentRows[0]?.total ?? 0) / 100).toFixed(2)}</b>\n🤝 Referrals: ${Number(referralsCount[0]?.count ?? 0)}\n\n🔗 Your referral link:\nhttps://t.me/${PUBLIC_BOT_USERNAME}?start=ref_${user?.referralCode ?? ""}`, buildHomeKeyboard(), messageId);
}

async function showReferrals(chatId: number, userId: number, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const referralsCount = await db.select({ count: sql<number>`count(*)` }).from(referrals).where(eq(referrals.referrerId, user?.id ?? -1));
  const rewards = await db.select().from(products).where(and(eq(products.active, 1), eq(products.referralEligible, 1), gt(products.stock, 0))).orderBy(products.name);
  const rewardRows = rewards.map((product) => [{ text: `🎁 ${product.name} · ${product.referralPriceCredits} credit${product.referralPriceCredits === 1 ? "" : "s"}`, callback_data: `reward:${product.id}` }]);
  const rewardText = rewards.length ? `\n\n🎁 <b>Available rewards</b>\nClaim selected products using your credits:` : "\n\nNo referral rewards are available right now.";
  await respond(chatId, `🤝 <b>Referrals</b>\n\nInvite friends with your personal link and earn 1 credit for each new bot user.\n\n👥 Successful referrals: <b>${Number(referralsCount[0]?.count ?? 0)}</b>\n🎟️ Referral credits: <b>${user?.referralCredits ?? 0}</b>\n🏅 Current tier: <b>${user?.tier ?? "Bronze"}</b>${rewardText}\n\n🔗 Your referral link:\nhttps://t.me/${PUBLIC_BOT_USERNAME}?start=ref_${user?.referralCode ?? ""}`, keyboard([...rewardRows, [{ text: "⌂ Home", callback_data: "home" }]]), messageId);
}

async function claimReferralReward(chatId: number, userId: number, productId: number, messageId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const outcome = await db.transaction(async (tx) => {
    const user = (await tx.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
    const product = (await tx.select().from(products).where(eq(products.id, productId)).limit(1))[0];
    if (!user || !product || !product.active || !product.referralEligible || product.referralPriceCredits < 1) return { ok: false as const, reason: "unavailable" as const };
    if (user.referralCredits < product.referralPriceCredits) return { ok: false as const, reason: "credits" as const, credits: user.referralCredits, required: product.referralPriceCredits };
    if (product.stock < 1) return { ok: false as const, reason: "stock" as const };
    const inventoryText = String(product.inventoryText ?? "");
    const digital = inventoryText.trim() ? consumeDigitalInventory(inventoryText, 1) : { ok: true as const, items: [] as string[], remaining: [] as string[] };
    if (!digital.ok) return { ok: false as const, reason: "stock" as const };
    const deliveryMode = product.deliveryMode === "manual" ? "manual" as const : "automatic" as const;
    const inserted = await tx.insert(orders).values({ botUserId: user.id, productId: product.id, kind: "referral", amountCents: 0, status: deliveryMode === "manual" ? "paid" : "fulfilled", deliveredItem: digital.items[0] ?? null, purchaseWarranty: normalizeWarrantyText(product.warrantyDays) || null, paymentMethod: "Referral credits", quantity: 1 });
    const orderId = String(extractInsertedRowId(inserted) || `${user.id}:referral:${product.id}:${Date.now()}`);
    await tx.update(botUsers).set({ referralCredits: sql`${botUsers.referralCredits} - ${product.referralPriceCredits}` }).where(eq(botUsers.id, user.id));
    await tx.update(products).set({ stock: product.stock - 1, inventoryText: String(product.inventoryText ?? "").trim() ? digital.remaining.join("\n") : product.inventoryText }).where(eq(products.id, product.id));
    return { ok: true as const, orderId, product, deliveryMode, item: digital.items[0] ?? "", userFirstName: user.firstName ?? undefined, userUsername: user.username ?? undefined, userTelegramId: user.telegramUserId };
  });
  if (!outcome.ok) {
    if (outcome.reason === "credits") return respond(chatId, `🎟️ <b>Not enough referral credits</b>\n\nThis reward costs <b>${outcome.required}</b> credit${outcome.required === 1 ? "" : "s"}. You have <b>${outcome.credits}</b>.`, undefined, messageId);
    if (outcome.reason === "stock") return respond(chatId, "⚠️ This referral reward is currently out of stock.", undefined, messageId);
    return respond(chatId, "⚠️ This referral reward is no longer available.", undefined, messageId);
  }
  const delivery = outcome.item ? `\n\n📦 <b>Your digital item</b>\n<blockquote>${outcome.item.replace(/[<&>]/g, "")}</blockquote>\n\nTap and hold the text above to copy it.` : outcome.deliveryMode === "manual" ? "\n\n🕐 The admin will deliver this reward shortly." : "";
  await respond(chatId, `✅ <b>Referral reward claimed</b>\n\n🎁 ${outcome.product.name}\n🎟️ Credits used: <b>${outcome.product.referralPriceCredits}</b>${delivery}`, keyboard([[{ text: "🤝 Back to Referrals", callback_data: "referrals" }], [{ text: "⌂ Home", callback_data: "home" }]]), messageId);
  scheduleDriveSync("referral_update");
  await notifyAdmin("referral_reward", String(outcome.orderId), formatReferralRewardNotification(outcome.product.name, outcome.product.referralPriceCredits, outcome.userFirstName ?? outcome.userUsername, outcome.userTelegramId));
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
  return respond(chatId, formatPurchaseReview(product.name, product.priceCents, safeQuantity, user.balanceCents, product.bulkPricing), buildPaymentMethodKeyboard(productId, safeQuantity), messageId);
}

async function cancelPurchase(chatId: number, userId: number, productId: number, messageId?: number) {
  const db = await getDb();
  pendingBinancePayPurchases.delete(userId);
  pendingCustomQuantities.delete(userId);
  if (db) {
    const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
    if (user) await db.update(paymentIntents).set({ status: "cancelled" }).where(and(eq(paymentIntents.botUserId, user.id), eq(paymentIntents.status, "pending")));
  }
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
    const purchase = buildConfirmedPurchasePlan(user.balanceCents, product.priceCents, product.stock, requestedQuantity, product.bulkPricing);
    if (!purchase.ok) return { ok: false as const, status: purchase.status, balanceCents: user.balanceCents, productId: product.id, stock: product.stock, totalCents: purchase.totalCents };
    const digital = product.inventoryText?.trim() ? consumeDigitalInventory(product.inventoryText, purchase.quantity) : { ok: true as const, items: [] as string[], remaining: [] as string[] };
    if (!digital.ok) return { ok: false as const, status: "out_of_stock" as const, productId: product.id, stock: product.stock, totalCents: purchase.totalCents };
    const deliveryMode = product.deliveryMode === "manual" ? "manual" as const : "automatic" as const;
    const result = await tx.insert(orders).values({ botUserId: user.id, productId: product.id, kind: "purchase", amountCents: purchase.totalCents, status: "fulfilled", deliveredItem: digital.items.length ? digital.items.join("\n") : null, purchaseWarranty: normalizeWarrantyText(product.warrantyDays) || null, paymentMethod: "Wallet", quantity: purchase.quantity });
    const orderId = String(extractInsertedRowId(result) || `${user.id}:${product.id}:${Date.now()}`);
    await tx.update(botUsers).set({ balanceCents: purchase.nextBalanceCents }).where(eq(botUsers.id, user.id));
    await tx.update(products).set({ stock: purchase.nextStock, inventoryText: String(product.inventoryText ?? "").trim() ? digital.remaining.join("\n") : product.inventoryText }).where(eq(products.id, product.id));
    await tx.insert(walletLedger).values({ botUserId: user.id, amountCents: -purchase.totalCents, kind: "purchase", referenceId: orderId, note: `${deliveryMode === "manual" ? "Manual" : "Automatic"} purchase (${purchase.quantity}×): ${product.name}` });
    return { ok: true as const, orderId, productId: product.id, productName: product.name, quantity: purchase.quantity, totalCents: purchase.totalCents, buyerName: user.firstName ?? user.username ?? "User", telegramUserId: user.telegramUserId, deliveryMode, deliveredItems: digital.items, warrantyDays: product.warrantyDays };
  });
  if (!outcome.ok) {
    if (outcome.status === "insufficient_balance") return respond(chatId, `💳 <b>Insufficient balance</b>\n\nYour balance is <b>$${(outcome.balanceCents / 100).toFixed(2)}</b>. This quantity costs <b>$${(outcome.totalCents / 100).toFixed(2)}.</b>`, buildQuantityKeyboard(outcome.productId, outcome.stock), messageId);
    if (outcome.status === "out_of_stock") return respond(chatId, "⚠️ The requested quantity is no longer available.", buildQuantityKeyboard(outcome.productId, outcome.stock), messageId);
    return respond(chatId, "⚠️ This product is currently unavailable.\n\nOpen the current Shop to choose an in-stock product.", buildUnavailableProductKeyboard(), messageId);
  }
  scheduleDriveSync("wallet_balance");
  scheduleDriveSync("completed_order");
  const announcement = buildPurchaseAnnouncement(outcome.productId, outcome.productName, outcome.quantity, outcome.buyerName, outcome.telegramUserId);
  await respond(chatId, formatPurchaseConfirmation(outcome.orderId, `${outcome.quantity}× ${outcome.productName}`, outcome.totalCents, { mode: outcome.deliveryMode, items: outcome.deliveredItems, warrantyDays: outcome.warrantyDays }), buildHomeKeyboard(), messageId);
  await notifyAdmin("order_fulfilled", String(outcome.orderId), announcement.text, announcement.replyMarkup);
}

async function createBinancePayPurchaseIntent(chatId: number, userId: number, productId: number, quantity: number, messageId?: number, method: "binance_pay" | "bep20" = "binance_pay") {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const product = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  const safeQuantity = Math.max(1, Math.min(10, Math.floor(quantity)));
  if (!user || !isPurchasableProduct(product)) return respond(chatId, "⚠️ This product is currently unavailable.\\n\\nOpen the current Shop to choose an in-stock product.", buildUnavailableProductKeyboard(), messageId);
  if (product.stock < safeQuantity) return respond(chatId, `⚠️ Only <b>${product.stock}</b> unit${product.stock === 1 ? "" : "s"} remain. Choose a smaller quantity.`, buildQuantityKeyboard(product.id, product.stock), messageId);
  const amountCents = resolveBulkUnitPriceCents(product.priceCents, product.bulkPricing, safeQuantity) * safeQuantity;
  const createdAtMs = Date.now();
  const inserted = await db.insert(paymentIntents).values({ botUserId: user.id, productId: product.id, quantity: safeQuantity, amountCents, method, status: "pending", createdAt: new Date(createdAtMs), updatedAt: new Date(createdAtMs) });
  const intentId = extractInsertedRowId(inserted);
  if (!intentId) throw new Error("Failed to create Binance Pay payment intent");
  pendingBinancePayPurchases.set(userId, { intentId, expiresAt: createdAtMs + (method === "bep20" ? BEP20_PURCHASE_WINDOW_MS : BINANCE_PAY_PURCHASE_WINDOW_MS) });
  const prompt = method === "bep20" ? formatBep20PurchasePrompt(product.name, safeQuantity, amountCents) : formatBinancePayPurchasePrompt(product.name, safeQuantity, amountCents);
  const invoiceKeyboard = method === "bep20" ? keyboard([[{ text: "📋 Copy BEP20 address", copy_text: { text: bep20DepositAddress() } }], [{ text: "✖️ Cancel", callback_data: `buycancel:${product.id}` }]]) : keyboard([[{ text: "📋 Copy Binance Pay ID", copy_text: { text: merchantBinanceId() } }], [{ text: "✖️ Cancel", callback_data: `buycancel:${product.id}` }]]);
  return respond(chatId, prompt, invoiceKeyboard, messageId);
}

export type TelegramCallbackAction =
  | { kind: "verify_membership" | "home" | "developer_api" | "wallet" | "walletadd" | "walletbep20" | "walletstars" | "walletstars_pay" | "walletcancel" | "orders" | "profile" | "referrals" | "support" | "support_new" | "support_history" | "support_cancel" | "botinfo" | "admin_stats" | "admin_tickets" | "admin_broadcast_help" | "admin_settings" | "admin_diagnostics" | "admin_delete_help" }
  | { kind: "support_category"; category: SupportCategory }
  | { kind: "support_order" | "support_payment" | "ticket_detail"; id: number }
  | { kind: "support_page" | "tickets_page"; page: number }
  | { kind: "admin_close_ticket"; id: number }
  | { kind: "shop" | "product" | "reward" | "buy" | "customqty" | "pricealert"; id: number }
  | { kind: "walletamount"; amountCents: number }
  | { kind: "orders_page"; page: number }
  | { kind: "order_detail"; id: number; page: number }
  | { kind: "order_buy_again"; id: number }
  | { kind: "buyqty" | "buyconfirm" | "paywallet" | "paybinance" | "paybep20" | "paystars"; id: number; quantity: number }
  | { kind: "buycancel"; id: number };

export function parseTelegramCallbackAction(data?: string): TelegramCallbackAction | null {
  const value = data ?? "";
  if (["verify_membership", "home", "developer_api", "wallet", "walletadd", "walletbep20", "walletstars", "walletstars_pay", "walletcancel", "orders", "profile", "referrals", "support", "support_new", "support_history", "support_cancel", "botinfo", "admin_stats", "admin_tickets", "admin_broadcast_help", "admin_settings", "admin_diagnostics", "admin_delete_help"].includes(value)) return { kind: value as TelegramCallbackAction["kind"] } as TelegramCallbackAction;
  const supportCategoryMatch = value.match(/^support_category:(completed_order|payment_verification|bot_issue|other)$/);
  if (supportCategoryMatch) return { kind: "support_category", category: supportCategoryMatch[1] as SupportCategory };
  const supportOrderMatch = value.match(/^support_order:(\d+)$/);
  if (supportOrderMatch) return { kind: "support_order", id: Number(supportOrderMatch[1]) };
  const supportPaymentMatch = value.match(/^support_payment:(\d+)$/);
  if (supportPaymentMatch) return { kind: "support_payment", id: Number(supportPaymentMatch[1]) };
  const ticketDetailMatch = value.match(/^ticket_detail:(\d+)$/);
  if (ticketDetailMatch) return { kind: "ticket_detail", id: Number(ticketDetailMatch[1]) };
  const supportPageMatch = value.match(/^support_page:(\d+)$/);
  if (supportPageMatch) return { kind: "support_page", page: Number(supportPageMatch[1]) };
  const ticketsPageMatch = value.match(/^tickets_page:(\d+)$/);
  if (ticketsPageMatch) return { kind: "tickets_page", page: Number(ticketsPageMatch[1]) };
  const adminCloseTicketMatch = value.match(/^admin_close_ticket:(\d+)$/);
  if (adminCloseTicketMatch) return { kind: "admin_close_ticket", id: Number(adminCloseTicketMatch[1]) };
  const walletAmountMatch = value.match(/^walletamount:(\d+)$/);
  if (walletAmountMatch) return { kind: "walletamount", amountCents: Number(walletAmountMatch[1]) };
  const ordersPageMatch = value.match(/^orders_page:(\d+)$/);
  if (ordersPageMatch) return { kind: "orders_page", page: Number(ordersPageMatch[1]) };
  const orderDetailMatch = value.match(/^order_detail:(\d+):(\d+)$/);
  if (orderDetailMatch) return { kind: "order_detail", id: Number(orderDetailMatch[1]), page: Number(orderDetailMatch[2]) };
  const orderBuyAgainMatch = value.match(/^order_buy_again:(\d+)$/);
  if (orderBuyAgainMatch) return { kind: "order_buy_again", id: Number(orderBuyAgainMatch[1]) };
  const quantityMatch = value.match(/^(buyqty|buyconfirm|paywallet|paybinance|paybep20|paystars):([0-9]+):([0-9]+)$/);
  if (quantityMatch) return { kind: quantityMatch[1] as "buyqty" | "buyconfirm" | "paywallet" | "paybinance" | "paybep20" | "paystars", id: Number(quantityMatch[2]), quantity: Number(quantityMatch[3]) };
  const cancelMatch = value.match(/^buycancel:([0-9]+)$/);
  if (cancelMatch) return { kind: "buycancel", id: Number(cancelMatch[1]) };
  const match = value.match(/^(shop|product|reward|buy|customqty|pricealert)(?::(\d+))?$/);
  if (!match) return null;
  if (match[1] === "shop" && match[2] === undefined) return { kind: "shop", id: 0 };
  if (!match[2]) return null;
  return { kind: match[1] as "shop" | "product" | "reward" | "buy", id: Number(match[2]) };
}

export function resolvePurchaseCallbackRoute(action: TelegramCallbackAction) {
  if (action.kind === "walletamount") return "wallet_amount" as const;
  if (action.kind === "buy") return "quantity_prompt" as const;
  if (action.kind === "buyqty") return action.quantity > 0 ? "purchase_review" as const : "quantity_prompt" as const;
  if (action.kind === "buyconfirm") return "payment_method" as const;
  if (action.kind === "paywallet") return "purchase_confirm" as const;
  if (action.kind === "paybinance" || action.kind === "paybep20") return "binance_pay_pending" as const;
  if (action.kind === "paystars") return "telegram_stars_pending" as const;
  if (action.kind === "buycancel") return "product_view" as const;
  if (action.kind === "customqty") return "custom_quantity" as const;
  if (action.kind === "pricealert") return "price_alert" as const;
  return null;
}

export async function handleCallback(query: TelegramCallbackQuery, options: { skipAccess?: boolean } = {}) {
  rememberNonTextCallbackMessage(query.message);
  const chatId = query.message?.chat.id;
  const messageId = query.message?.message_id;
  if (!chatId) return;
  const userId = query.from.id;
  await answerCallback(query.id);
  // Acknowledge the tap first; activity bookkeeping must never delay callback routing or the user-facing reply.
  void recordBotActivity(userId).catch((error) => console.error("[Telegram] callback activity touch failed", error));
  const action = parseTelegramCallbackAction(query.data);
  if (!action) return;
  if (["admin_stats", "admin_tickets", "admin_broadcast_help", "admin_settings", "admin_diagnostics", "admin_delete_help", "admin_close_ticket"].includes(action.kind)) {
    if (!isAuthorizedAdminMessage({ chat: { id: chatId, type: query.message?.chat.type ?? "" }, from: query.from })) return respond(chatId, "⚠️ This administrator action is not available.", undefined, messageId);
    if (action.kind === "admin_stats") return showBotInfo(chatId, messageId, true);
    if (action.kind === "admin_tickets") { await showAdminTickets(chatId); return; }
    if (action.kind === "admin_close_ticket") { await closeAdminTicket(chatId, action.id); return; }
    if (action.kind === "admin_settings") { await showAdminSettings(chatId); return; }
    if (action.kind === "admin_diagnostics") { await showAdminDiagnostics(chatId); return; }
    if (action.kind === "admin_broadcast_help") return respond(chatId, "<b>📢 Broadcast</b>\\n\\nSend <code>/broadcast your message</code> to deliver it to all known bot users. The completion report includes sent count, failed count, Telegram ID, username, and the exact failure reason returned by Telegram.", buildAdminKeyboard(), messageId);
    return respond(chatId, "<b>🗑️ Delete a bot user</b>\\n\\nSend <code>/deleteuser &lt;telegram-user-id&gt;</code>. This permanently removes the user and associated bot records from the database and synchronizes the change to Drive.", buildAdminKeyboard(), messageId);
  }
  const paymentOption = paymentOptionForCallback(action);
  if (paymentOption && !isPaymentOptionEnabled(paymentOption)) {
    const unavailableKeyboard = isPurchasePaymentCallback(action) ? buildPaymentMethodKeyboard(action.id, action.quantity) : buildWalletKeyboard();
    return respond(chatId, formatPaymentUnavailableMessage(paymentOption), unavailableKeyboard, messageId);
  }
  const purchaseRoute = resolvePurchaseCallbackRoute(action);
  if (action.kind === "verify_membership") {
    clearMembershipCache(userId);
    return showHome(chatId, userId, messageId);
  }
  if (!options.skipAccess && !(await requireAccess(chatId, userId, messageId))) return;
  if (action.kind === "home") return showHome(chatId, userId, messageId);
  if (action.kind === "developer_api") return respond(chatId, formatDeveloperApiMessage(), keyboard([[{ text: "🆘 Contact Support", callback_data: "support", style: "success" }], [{ text: "🏠 Back to home", callback_data: "home" }]]), messageId);
  if (action.kind === "shop") return showShop(chatId, action.id, messageId);
  if (action.kind === "product") return showProduct(chatId, action.id, messageId);
  if (action.kind === "wallet") return showWallet(chatId, userId, messageId);
  if (action.kind === "walletstars") {
    const openedAt = Date.now();
    pendingTelegramStarsWalletTopups.set(userId, { expiresAt: openedAt + 30 * 60 * 1000 });
    return respond(chatId, formatWalletDepositAmountPrompt(undefined, "telegram_stars"), buildWalletDepositAmountKeyboard(), messageId);
  }
  if (action.kind === "walletstars_pay") return sendTelegramStarsWalletInvoice(chatId, userId, messageId);
  if (action.kind === "walletadd" || action.kind === "walletbep20") {
    const method = action.kind === "walletbep20" ? "bep20" as const : "binance_pay" as const;
    const openedAt = Date.now();
    pendingBinancePayTopups.set(userId, { method, expiresAt: openedAt + (method === "bep20" ? BEP20_PURCHASE_WINDOW_MS : BINANCE_PAY_PURCHASE_WINDOW_MS) });
    return respond(chatId, formatWalletDepositAmountPrompt(undefined, method), buildWalletDepositAmountKeyboard(), messageId);
  }
  if (action.kind === "walletcancel") {
    pendingBinancePayTopups.delete(userId);
    pendingTelegramStarsWalletTopups.delete(userId);
    return showWallet(chatId, userId, messageId);
  }
  if (purchaseRoute === "wallet_amount" && action.kind === "walletamount") {
    if (!Number.isSafeInteger(action.amountCents) || action.amountCents < 1) return respond(chatId, formatWalletDepositAmountPrompt("range"), buildWalletDepositAmountKeyboard(), messageId);
    const method = pendingBinancePayTopups.get(userId)?.method ?? "binance_pay";
    const invoiceCreatedAt = Date.now();
    pendingBinancePayTopups.set(userId, { amountCents: action.amountCents, method, createdAt: invoiceCreatedAt, expiresAt: invoiceCreatedAt + (method === "bep20" ? BEP20_PURCHASE_WINDOW_MS : BINANCE_PAY_PURCHASE_WINDOW_MS) });
    const prompt = method === "bep20" ? formatBep20TopupPrompt(action.amountCents) : formatBinancePayTopupPrompt(action.amountCents);
    return respond(chatId, prompt, buildWalletDepositInvoiceKeyboard(method), messageId);
  }
  if (action.kind === "orders") return showOrders(chatId, userId, messageId, 0);
  if (action.kind === "orders_page") return showOrders(chatId, userId, messageId, action.page);
  if (action.kind === "order_detail") return showOrderDetails(chatId, userId, action.id, action.page, messageId);
  if (action.kind === "order_buy_again") return buyAgainFromOrder(chatId, userId, action.id, messageId);
  if (action.kind === "profile") return showProfile(chatId, userId, messageId);
  if (action.kind === "referrals") return showReferrals(chatId, userId, messageId);
  if (action.kind === "botinfo") return showBotInfo(chatId, messageId);
  if (action.kind === "support" || action.kind === "support_new") return showSupportMenu(chatId, messageId);
  if (action.kind === "support_cancel") {
    pendingSupportMessages.delete(userId);
    return showHome(chatId, userId, messageId);
  }
  if (action.kind === "support_history") return showSupportHistory(chatId, userId, 0, messageId);
  if (action.kind === "tickets_page") return showSupportHistory(chatId, userId, action.page, messageId);
  if (action.kind === "ticket_detail") return showSupportTicketDetail(chatId, userId, action.id, messageId);
  if (action.kind === "support_category") return beginSupportCategory(chatId, userId, action.category, messageId);
  if (action.kind === "support_page") return showSupportOrderPicker(chatId, userId, action.page, messageId);
  if (action.kind === "support_order") {
    const draft = pendingSupportMessages.get(userId);
    if (!draft || draft.step !== "order") return showSupportMenu(chatId, messageId);
    const db = await getDb();
    if (!db) throw new Error("Database is unavailable");
    const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
    const order = user ? (await db.select().from(orders).where(and(eq(orders.id, action.id), eq(orders.botUserId, user.id), or(eq(orders.status, "fulfilled"), eq(orders.status, "paid")))).limit(1))[0] : undefined;
    if (!order) return showSupportOrderPicker(chatId, userId, 0, messageId);
    const product = (await db.select().from(products).where(eq(products.id, order.productId)).limit(1))[0];
    pendingSupportMessages.set(userId, { ...draft, step: "description", orderId: order.id, expiresAt: Date.now() + SUPPORT_MESSAGE_WINDOW_MS });
    return respond(chatId, formatSupportDescriptionPrompt("completed_order", { orderName: product?.name ?? `Order #${order.id}` }), supportDescriptionKeyboard(), messageId);
  }
  if (action.kind === "support_payment") {
    const draft = pendingSupportMessages.get(userId);
    const paymentMethod = supportPaymentName(action.id);
    if (!draft || draft.step !== "payment_method" || !paymentMethod) return showSupportMenu(chatId, messageId);
    pendingSupportMessages.set(userId, { ...draft, step: "description", paymentMethod, expiresAt: Date.now() + SUPPORT_MESSAGE_WINDOW_MS });
    return respond(chatId, formatSupportDescriptionPrompt("payment_verification", { paymentMethod }), supportDescriptionKeyboard(), messageId);
  }
  if (action.kind === "reward") return claimReferralReward(chatId, userId, action.id, messageId);
  if (purchaseRoute === "quantity_prompt" && (action.kind === "buy" || (action.kind === "buyqty" && action.quantity === 0))) return showQuantityPrompt(chatId, action.id, messageId);
  if (purchaseRoute === "purchase_review" && action.kind === "buyqty") return showPurchaseReview(chatId, userId, action.id, action.quantity, messageId);
  if (purchaseRoute === "payment_method" && action.kind === "buyconfirm") return showPurchaseReview(chatId, userId, action.id, action.quantity, messageId);
  if (purchaseRoute === "purchase_confirm" && action.kind === "paywallet") return createPurchase(chatId, userId, action.id, action.quantity, messageId);
  if (purchaseRoute === "binance_pay_pending" && (action.kind === "paybinance" || action.kind === "paybep20")) return createBinancePayPurchaseIntent(chatId, userId, action.id, action.quantity, messageId, action.kind === "paybep20" ? "bep20" : "binance_pay");
  if (purchaseRoute === "telegram_stars_pending" && action.kind === "paystars") return createTelegramStarsPurchaseIntent(chatId, userId, action.id, action.quantity);
  if (action.kind === "buycancel") return cancelPurchase(chatId, userId, action.id, messageId);
  if (purchaseRoute === "custom_quantity" && action.kind === "customqty") {
    const db = await getDb();
    if (!db) throw new Error("Database is unavailable");
    const product = (await db.select().from(products).where(eq(products.id, action.id)).limit(1))[0];
    if (!isPurchasableProduct(product)) return respond(chatId, "⚠️ This product is currently unavailable.", undefined, messageId);
    pendingCustomQuantities.set(userId, { productId: action.id, expiresAt: Date.now() + 5 * 60 * 1000 });
    return respond(chatId, formatCustomQuantityPrompt(product.name, product.stock), buildCustomQuantityKeyboard(product.id), messageId);
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

async function sendTelegramStarsWalletInvoice(chatId: number, userId: number, messageId?: number) {
  const pending = pendingTelegramStarsWalletTopups.get(userId);
  if (!pending || pending.expiresAt <= Date.now() || pending.amountCents === undefined) return respond(chatId, formatWalletDepositAmountPrompt("invalid", "telegram_stars"), buildWalletDepositAmountKeyboard(), messageId);
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const account = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  if (!account) return respond(chatId, "⚠️ Your bot account is not ready yet. Send /start and try again.", buildWalletKeyboard(), messageId);
  const starsAmount = usdCentsToTelegramStars(pending.amountCents);
  const payload = `toolsmania-wallet-stars:${userId}:${Date.now()}`;
  await db.insert(telegramStarsWalletPayments).values({ botUserId: account.id, amountCents: pending.amountCents, starsAmount, payload, status: "pending", createdAt: new Date(), updatedAt: new Date() });
  pendingTelegramStarsWalletTopups.delete(userId);
  await sendStarsInvoice(chatId, "ToolsMania wallet deposit", `Wallet credit: $${(pending.amountCents / 100).toFixed(2)}`, payload, starsAmount);
}

async function createTelegramStarsPurchaseIntent(chatId: number, userId: number, productId: number, quantity: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const user = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const product = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  const safeQuantity = Math.max(1, Math.min(10, Math.floor(quantity)));
  if (!user || !isPurchasableProduct(product)) return sendMessage(chatId, "⚠️ This product is currently unavailable.");
  if (product.stock < safeQuantity) return sendMessage(chatId, `⚠️ Only <b>${product.stock}</b> unit${product.stock === 1 ? "" : "s"} remain.`);
  const amountCents = resolveBulkUnitPriceCents(product.priceCents, product.bulkPricing, safeQuantity) * safeQuantity;
  const stars = usdCentsToTelegramStars(amountCents);
  const now = new Date();
  const inserted = await db.insert(paymentIntents).values({ botUserId: user.id, productId: product.id, quantity: safeQuantity, amountCents, method: "telegram_stars", status: "pending", createdAt: now, updatedAt: now });
  const intentId = extractInsertedRowId(inserted);
  if (!intentId) throw new Error("Failed to create Telegram Stars payment intent");
  const payload = `toolsmania-stars:${intentId}`;
  await sendStarsInvoice(chatId, product.name.slice(0, 32), `Digital delivery: ${safeQuantity}× ${product.name}`.slice(0, 255), payload, stars);
}

async function answerPreCheckoutQuery(queryId: string, ok: boolean, errorMessage?: string) {
  return telegramCall("answerPreCheckoutQuery", { pre_checkout_query_id: queryId, ok, ...(ok ? {} : { error_message: errorMessage ?? "This order cannot be processed right now." }) });
}

async function handleStarsPreCheckout(query: TelegramPreCheckoutQuery) {
  const walletMatch = query.invoice_payload.match(/^toolsmania-wallet-stars:(\d+):(\d+)$/);
  if (walletMatch) {
    if (query.currency !== "XTR") return answerPreCheckoutQuery(query.id, false, "This Telegram Stars invoice is invalid.");
    const db = await getDb();
    if (!db) return answerPreCheckoutQuery(query.id, false, "The wallet is temporarily unavailable.");
    const walletPayment = (await db.select().from(telegramStarsWalletPayments).where(eq(telegramStarsWalletPayments.payload, query.invoice_payload)).limit(1))[0];
    if (!walletPayment || walletPayment.status !== "pending" || query.total_amount !== walletPayment.starsAmount) return answerPreCheckoutQuery(query.id, false, "This wallet invoice is no longer available. Please create a new one.");
    return answerPreCheckoutQuery(query.id, true);
  }
  const match = query.invoice_payload.match(/^toolsmania-stars:(\d+)$/);
  if (!match || query.currency !== "XTR") return answerPreCheckoutQuery(query.id, false, "This Telegram Stars invoice is invalid.");
  const db = await getDb();
  if (!db) return answerPreCheckoutQuery(query.id, false, "The store is temporarily unavailable.");
  const intent = (await db.select().from(paymentIntents).where(eq(paymentIntents.id, Number(match[1]))).limit(1))[0];
  const product = intent ? (await db.select().from(products).where(eq(products.id, intent.productId)).limit(1))[0] : undefined;
  if (!intent || intent.method !== "telegram_stars" || intent.status !== "pending" || !product || !isPurchasableProduct(product) || product.stock < intent.quantity || query.total_amount !== usdCentsToTelegramStars(intent.amountCents)) {
    return answerPreCheckoutQuery(query.id, false, "This invoice is no longer available. Please create a new invoice.");
  }
  return answerPreCheckoutQuery(query.id, true);
}

async function verifyAndFulfillTelegramStarsWalletDeposit(chatId: number, userId: number, payment: TelegramSuccessfulPayment) {
  if (payment.currency !== "XTR") return sendMessage(chatId, "⚠️ This Telegram Stars wallet payment is invalid.");
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const current = (await db.select().from(telegramStarsWalletPayments).where(eq(telegramStarsWalletPayments.payload, payment.invoice_payload)).limit(1))[0];
  if (!current || current.status !== "pending") return sendMessage(chatId, "ℹ️ This Telegram Stars wallet payment was already processed or is no longer pending.");
  if (payment.total_amount !== current.starsAmount) return sendMessage(chatId, "⚠️ The Telegram Stars amount did not match the wallet invoice.");
  const outcome = await db.transaction(async (tx) => {
    const row = (await tx.select().from(telegramStarsWalletPayments).where(eq(telegramStarsWalletPayments.id, current.id)).limit(1))[0];
    if (!row || row.status !== "pending") return { ok: false as const, reason: "already_processed" as const };
    const reused = (await tx.select().from(telegramStarsWalletPayments).where(eq(telegramStarsWalletPayments.transactionId, payment.telegram_payment_charge_id)).limit(1))[0];
    if (reused) return { ok: false as const, reason: "already_used" as const };
    const account = (await tx.select().from(botUsers).where(eq(botUsers.id, row.botUserId)).limit(1))[0];
    const sender = (await tx.select({ id: botUsers.id }).from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
    if (!account || account.id !== sender?.id) return { ok: false as const, reason: "user_mismatch" as const };
    await tx.update(botUsers).set({ balanceCents: account.balanceCents + row.amountCents }).where(eq(botUsers.id, account.id));
    await tx.insert(walletLedger).values({ botUserId: account.id, amountCents: row.amountCents, kind: "topup", referenceId: payment.telegram_payment_charge_id, note: `Telegram Stars deposit (${row.starsAmount} XTR)` });
    await tx.update(telegramStarsWalletPayments).set({ status: "credited", transactionId: payment.telegram_payment_charge_id, updatedAt: new Date() }).where(eq(telegramStarsWalletPayments.id, row.id));
    return { ok: true as const, amountCents: row.amountCents };
  });
  if (!outcome.ok) return sendMessage(chatId, outcome.reason === "user_mismatch" ? "⚠️ This wallet invoice belongs to a different account." : "ℹ️ This Telegram Stars wallet payment was already processed.");
  scheduleDriveSync("wallet_balance");
  return sendMessage(chatId, `✅ <b>Wallet credited</b>\n\nAdded <b>$${(outcome.amountCents / 100).toFixed(2)}</b> using Telegram Stars.`, buildWalletKeyboard());
}

async function verifyAndFulfillTelegramStarsPurchase(chatId: number, userId: number, payment: TelegramSuccessfulPayment) {
  const match = payment.invoice_payload.match(/^toolsmania-stars:(\d+)$/);
  if (!match || payment.currency !== "XTR") return sendMessage(chatId, "⚠️ This Telegram Stars payment could not be matched to an order.");
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const intentId = Number(match[1]);
  const transactionRef = payment.telegram_payment_charge_id;
  const outcome = await db.transaction(async (tx) => {
    const current = (await tx.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1))[0];
    if (!current || current.method !== "telegram_stars" || current.status !== "pending") return { ok: false as const, reason: "already_processed" as const };
    if (payment.total_amount !== usdCentsToTelegramStars(current.amountCents)) return { ok: false as const, reason: "amount_mismatch" as const };
    const reused = (await tx.select().from(paymentIntents).where(eq(paymentIntents.transactionId, transactionRef)).limit(1))[0];
    if (reused) return { ok: false as const, reason: "already_used" as const };
    const account = (await tx.select().from(botUsers).where(eq(botUsers.id, current.botUserId)).limit(1))[0];
    const sender = (await tx.select({ id: botUsers.id }).from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
    const product = (await tx.select().from(products).where(eq(products.id, current.productId)).limit(1))[0];
    if (!account || account.id !== sender?.id) return { ok: false as const, reason: "user_mismatch" as const };
    if (!product || !isPurchasableProduct(product) || product.stock < current.quantity) return { ok: false as const, reason: "unavailable" as const };
    const digital = product.inventoryText?.trim() ? consumeDigitalInventory(product.inventoryText, current.quantity) : { ok: true as const, items: [] as string[], remaining: [] as string[] };
    if (!digital.ok) return { ok: false as const, reason: "unavailable" as const };
    const deliveryMode = product.deliveryMode === "manual" ? "manual" as const : "automatic" as const;
    const inserted = await tx.insert(orders).values({ botUserId: account.id, productId: product.id, kind: "purchase", amountCents: current.amountCents, status: deliveryMode === "manual" ? "paid" : "fulfilled", deliveredItem: digital.items.length ? digital.items.join("\\n") : null, purchaseWarranty: normalizeWarrantyText(product.warrantyDays) || null, paymentMethod: "Telegram Stars", quantity: current.quantity });
    const orderId = extractInsertedRowId(inserted) || Number(`${Date.now()}`.slice(-9));
    await tx.update(products).set({ stock: sql`${products.stock} - ${current.quantity}`, inventoryText: String(product.inventoryText ?? "").trim() ? digital.remaining.join("\\n") : product.inventoryText }).where(eq(products.id, product.id));
    await tx.update(paymentIntents).set({ status: "fulfilled", transactionId: transactionRef }).where(eq(paymentIntents.id, current.id));
    return { ok: true as const, orderId, product, quantity: current.quantity, amountCents: current.amountCents, deliveryMode, deliveredItems: digital.items, warrantyDays: product.warrantyDays };
  });
  if (!outcome.ok) {
    const text = outcome.reason === "unavailable" ? "⚠️ The product sold out before payment completion. Contact support with your Telegram payment charge ID." : outcome.reason === "amount_mismatch" ? "⚠️ The Telegram Stars amount did not match the invoice." : outcome.reason === "user_mismatch" ? "⚠️ This invoice belongs to a different account." : "ℹ️ This Telegram Stars payment was already processed.";
    return sendMessage(chatId, text);
  }
  scheduleDriveSync("completed_order");
  const buyer = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const announcement = buildPurchaseAnnouncement(outcome.product.id, outcome.product.name, outcome.quantity, buyer?.firstName ?? buyer?.username ?? "User", userId);
  await sendMessage(chatId, formatPurchaseConfirmation(outcome.orderId, `${outcome.quantity}× ${outcome.product.name}`, outcome.amountCents, { mode: outcome.deliveryMode, items: outcome.deliveredItems, warrantyDays: outcome.warrantyDays }), buildHomeKeyboard());
  await notifyAdmin("order_fulfilled", String(outcome.orderId), announcement.text, announcement.replyMarkup);
  return true;
}

async function verifyAndFulfillBinancePurchase(chatId: number, userId: number, intentId: number, transactionId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const intent = (await db.select().from(paymentIntents).where(eq(paymentIntents.id, intentId)).limit(1))[0];
  const isBep20 = intent?.method === "bep20";
  const paymentLabel = isBep20 ? "USDT BEP20 payment" : "Binance Pay order";
  if (!intent || intent.status !== "pending") { await respond(chatId, `ℹ️ This ${paymentLabel} is no longer pending. Open Shop to start a new purchase.`, buildHomeKeyboard()); return false; }
  const createdAtMs = intent.createdAt instanceof Date ? intent.createdAt.getTime() : new Date(intent.createdAt).getTime();
  const windowMs = isBep20 ? BEP20_PURCHASE_WINDOW_MS : BINANCE_PAY_PURCHASE_WINDOW_MS;
  if (!Number.isFinite(createdAtMs) || Date.now() >= createdAtMs + windowMs) {
    await respond(chatId, `⌛ <b>${isBep20 ? "USDT BEP20 invoice" : "Binance Pay order"} expired</b>\n\nCreate a new invoice before sending funds.`, buildPurchasePaymentFailureKeyboard(intent.productId));
    return false;
  }
  const result = await findBinancePayTransaction(transactionId, intent.amountCents, fetch, isBep20 ? "bep20" : "binance_pay", isBep20 ? createdAtMs : undefined);
  if (!result.ok) {
    const reason = formatPaymentVerificationFailure(result.reason, isBep20 ? "bep20" : "binance_pay", intent.amountCents);
    const identifierLabel = isBep20 ? "transaction hash (TxID)" : "Binance Pay order ID";
    await respond(chatId, `❌ <b>Payment not verified</b>\n\n${reason}\n\nSend the correct ${identifierLabel} within the remaining payment window.`, buildPurchasePaymentFailureKeyboard(intent.productId));
    return false;
  }
  const transactionRef = String(result.transaction.transactionId ?? transactionId.trim());
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
    const digital = product.inventoryText?.trim() ? consumeDigitalInventory(product.inventoryText, current.quantity) : { ok: true as const, items: [] as string[], remaining: [] as string[] };
    if (!digital.ok) return { ok: false as const, reason: "unavailable" as const };
    const deliveryMode = product.deliveryMode === "manual" ? "manual" as const : "automatic" as const;
    const inserted = await tx.insert(orders).values({ botUserId: account.id, productId: product.id, kind: "purchase", amountCents: current.amountCents, status: "fulfilled", deliveredItem: digital.items.length ? digital.items.join("\n") : null, purchaseWarranty: normalizeWarrantyText(product.warrantyDays) || null, paymentMethod: isBep20 ? "USDT BEP20" : "Binance Pay", quantity: current.quantity });
    const orderId = extractInsertedRowId(inserted) || Number(`${Date.now()}`.slice(-9));
    await tx.update(products).set({ stock: sql`${products.stock} - ${current.quantity}`, inventoryText: String(product.inventoryText ?? "").trim() ? digital.remaining.join("\n") : product.inventoryText }).where(eq(products.id, product.id));
    await tx.update(paymentIntents).set({ status: "fulfilled", transactionId: transactionRef }).where(eq(paymentIntents.id, current.id));
    return { ok: true as const, orderId, product, quantity: current.quantity, amountCents: current.amountCents, deliveryMode, deliveredItems: digital.items, warrantyDays: product.warrantyDays };
  });
  if (!outcome.ok) {
    const text = outcome.reason === "already_used" ? "ℹ️ This Binance Pay transaction was already used." : outcome.reason === "unavailable" ? "⚠️ The product sold out before payment verification. Contact support with your transaction ID." : outcome.reason === "user_mismatch" ? "⚠️ This payment intent belongs to a different account." : "ℹ️ This payment order was already processed.";
    await respond(chatId, text, buildHomeKeyboard());
    return false;
  }
  scheduleDriveSync("completed_order");
  const buyer = (await db.select().from(botUsers).where(eq(botUsers.telegramUserId, userId)).limit(1))[0];
  const announcement = buildPurchaseAnnouncement(outcome.product.id, outcome.product.name, outcome.quantity, buyer?.firstName ?? buyer?.username ?? "User", userId);
  await respond(chatId, formatPurchaseConfirmation(outcome.orderId, `${outcome.quantity}× ${outcome.product.name}`, outcome.amountCents, { mode: outcome.deliveryMode, items: outcome.deliveredItems, warrantyDays: outcome.warrantyDays }), buildHomeKeyboard());
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
  const createdAtMs = intent.createdAt instanceof Date ? intent.createdAt.getTime() : new Date(intent.createdAt).getTime();
  const pending = { intentId: intent.id, expiresAt: createdAtMs + (intent.method === "bep20" ? BEP20_PURCHASE_WINDOW_MS : BINANCE_PAY_PURCHASE_WINDOW_MS) };
  pendingBinancePayPurchases.set(userId, pending);
  return pending;
}

export async function handleMessage(message: TelegramMessage) {
  if (isAuthorizedAdminMessage(message)) {
    if (await handleAdminReply(message)) return;
    if (await handleAdminCommand(message)) return;
    const adminCommand = message.text?.trim().split(/\s+/)[0]?.toLowerCase();
    if (adminCommand === "/start" || adminCommand === "/admin") return sendMessage(message.chat.id, formatAdminHomeMessage(), buildAdminKeyboard());
    if (adminCommand === "/reply") return sendMessage(message.chat.id, "Usage: <code>/reply &lt;ticket-id&gt; &lt;message&gt;</code>", buildAdminKeyboard());
    return sendMessage(message.chat.id, formatAdminHomeMessage(), buildAdminKeyboard());
  }
  if (await handleAdminReply(message)) return;
  const user = message.from;
  if (!user || !message.text) return;
  const messageText = message.text;
  const isCommandMessage = messageText.trim().startsWith("/");
  const pendingTopup = pendingBinancePayTopups.get(user.id);
  const pendingStarsTopup = pendingTelegramStarsWalletTopups.get(user.id);
  const pendingPurchase = pendingBinancePayPurchases.get(user.id) ?? await restorePendingBinancePurchase(user.id);
  const pendingPurchaseExpired = pendingPurchase?.expiresAt !== undefined && pendingPurchase.expiresAt <= Date.now();
  if (pendingPurchase && shouldRoutePendingBinancePurchase(messageText, isCommandMessage, Boolean(pendingTopup), true)) {
    if (pendingPurchaseExpired) {
      pendingBinancePayPurchases.delete(user.id);
      return respond(message.chat.id, "⌛ <b>Payment invoice expired</b>\n\nOpen Shop and create a new invoice before sending funds.", buildHomeKeyboard());
    }
    const completed = await verifyAndFulfillBinancePurchase(message.chat.id, user.id, pendingPurchase.intentId, messageText);
    if (completed) pendingBinancePayPurchases.delete(user.id);
    return;
  }
  if (!isCommandMessage && pendingStarsTopup) {
    if (pendingStarsTopup.expiresAt <= Date.now()) {
      pendingTelegramStarsWalletTopups.delete(user.id);
      return respond(message.chat.id, "⌛ <b>Stars deposit invoice expired</b>\n\nOpen Wallet and tap Add funds with Telegram Stars to try again.", buildWalletKeyboard());
    }
    if (pendingStarsTopup.amountCents === undefined) {
      const parsed = parseUsdAmountInput(messageText);
      if (!parsed.ok) return respond(message.chat.id, formatWalletDepositAmountPrompt(parsed.reason, "telegram_stars"), buildWalletDepositAmountKeyboard());
      pendingStarsTopup.amountCents = parsed.amountCents;
      pendingStarsTopup.createdAt = Date.now();
      pendingStarsTopup.expiresAt = pendingStarsTopup.createdAt + 30 * 60 * 1000;
      return respond(message.chat.id, formatTelegramStarsTopupPrompt(parsed.amountCents, usdCentsToTelegramStars(parsed.amountCents)), buildTelegramStarsTopupKeyboard());
    }
  }
  if (!isCommandMessage && pendingTopup) {
    if (pendingTopup.expiresAt <= Date.now()) {
      pendingBinancePayTopups.delete(user.id);
      return respond(message.chat.id, "⌛ <b>Top-up invoice expired</b>\n\nOpen Wallet and tap Add funds with Binance Pay to try again.", buildWalletKeyboard());
    }
    if (pendingTopup.amountCents === undefined) {
      const parsed = parseUsdAmountInput(messageText);
      if (!parsed.ok) return respond(message.chat.id, formatWalletDepositAmountPrompt(parsed.reason, pendingTopup.method), buildWalletDepositAmountKeyboard());
      pendingTopup.amountCents = parsed.amountCents;
      pendingTopup.createdAt = Date.now();
      pendingTopup.expiresAt = pendingTopup.createdAt + (pendingTopup.method === "bep20" ? BEP20_PURCHASE_WINDOW_MS : BINANCE_PAY_PURCHASE_WINDOW_MS);
      const prompt = pendingTopup.method === "bep20" ? formatBep20TopupPrompt(parsed.amountCents) : formatBinancePayTopupPrompt(parsed.amountCents);
      return respond(message.chat.id, prompt, buildWalletDepositInvoiceKeyboard(pendingTopup.method));
    }
    const invoiceAmountCents = pendingTopup.amountCents;
    if (invoiceAmountCents === undefined) return respond(message.chat.id, "⚠️ Create a payment invoice first from Wallet.", buildWalletKeyboard());
    const result = await findBinancePayTransaction(messageText, invoiceAmountCents, fetch, pendingTopup.method, pendingTopup.method === "bep20" ? pendingTopup.createdAt : undefined);
    if (!result.ok) {
      const isBep20 = pendingTopup.method === "bep20";
      return respond(message.chat.id, `${formatTopupVerificationFailure(result.reason, isBep20 ? "bep20" : "binance_pay")}\n\nPlease submit another transaction hash, or tap Cancel to leave verification.`, buildWalletDepositInvoiceKeyboard(pendingTopup.method));
    }
    pendingBinancePayTopups.delete(user.id);
    const db = await getDb();
    if (!db) throw new Error("Database is unavailable");
    const credited = await db.transaction(async (tx) => {
      const transactionId = String(result.transaction.transactionId ?? messageText.trim());
      const existing = (await tx.select().from(binancePayDeposits).where(eq(binancePayDeposits.transactionId, transactionId)).limit(1))[0];
      if (existing) return { ok: false as const, reason: "already_credited" as const, amountCents: existing.amountCents, asset: existing.asset };
      const account = (await tx.select().from(botUsers).where(eq(botUsers.telegramUserId, user.id)).limit(1))[0];
      if (!account) return { ok: false as const, reason: "user_missing" as const };
      const creditedAmountCents = invoiceAmountCents;
      await tx.insert(binancePayDeposits).values({ botUserId: account.id, transactionId, amountCents: creditedAmountCents, asset: result.asset, rawStatus: result.transaction.status === undefined || result.transaction.status === null ? null : String(result.transaction.status) });
      await tx.update(botUsers).set({ balanceCents: account.balanceCents + creditedAmountCents }).where(eq(botUsers.id, account.id));
      await tx.insert(walletLedger).values({ botUserId: account.id, amountCents: creditedAmountCents, kind: "topup", referenceId: transactionId, note: `${pendingTopup.method === "bep20" ? "USDT BEP20" : "Binance Pay"} ${result.asset} transaction verified` });
      return { ok: true as const, amountCents: creditedAmountCents, asset: result.asset, transactionId };
    });
    if (!credited.ok && credited.reason === "already_credited") return respond(message.chat.id, `ℹ️ <b>Already credited</b>\n\nThis transaction was already added to a wallet for <b>$${(credited.amountCents / 100).toFixed(2)}</b>.`, buildWalletKeyboard());
    if (!credited.ok) return respond(message.chat.id, "⚠️ Your bot wallet could not be found. Send /start and try again.", buildHomeKeyboard());
    scheduleDriveSync("wallet_balance");
    return respond(message.chat.id, `✅ <b>Wallet credited</b>\n\n💰 Added: <b>$${(credited.amountCents / 100).toFixed(2)} ${credited.asset}</b>\n🧾 Transaction: <code>${credited.transactionId}</code>\n\nYour new balance is available in Wallet.`, buildWalletKeyboard());
  }
  const pendingSupport = pendingSupportMessages.get(user.id);
  if (pendingSupport && pendingSupport.expiresAt > Date.now() && !message.text.trim().startsWith("/")) {
    if (pendingSupport.step !== "description") {
      if (pendingSupport.step === "order") return showSupportOrderPicker(message.chat.id, user.id, 0);
      if (pendingSupport.step === "payment_method") return respond(message.chat.id, "Please choose a payment method using the buttons above.", supportPaymentKeyboard());
      return showSupportMenu(message.chat.id);
    }
    pendingSupportMessages.delete(user.id);
    try {
      const ticketId = await submitSupportTicket(user, message.text.trim(), pendingSupport);
      return sendMessage(message.chat.id, formatSupportSubmitted(ticketId), supportCategoryKeyboard());
    } catch (error) {
      recordTelegramFailure("support_ticket", error, { userId: user.id, chatId: message.chat.id });
      return sendMessage(message.chat.id, "⚠️ Support is temporarily unavailable. Please try again later or contact the administrator directly.");
    }
  }
  if (pendingSupport && pendingSupport.expiresAt <= Date.now()) pendingSupportMessages.delete(user.id);
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
    if (reply.kind === "retry") return respond(message.chat.id, reply.text, buildCustomQuantityKeyboard(product.id), message.reply_to_message?.message_id);
    pendingCustomQuantities.delete(user.id);
    return showPurchaseReview(message.chat.id, user.id, pending.productId, reply.quantity, message.reply_to_message?.message_id);
  }
  if (pending && pending.expiresAt <= Date.now()) pendingCustomQuantities.delete(user.id);
  const [command, ...rest] = message.text.trim().split(/\s+/);
  const referral = rest.find((part) => part.startsWith("ref_"))?.slice(4);
  const productDeepLink = rest.find((part) => part.startsWith("product_"))?.slice(8);
  const referralsDeepLink = rest.includes("referrals");
  const account = await ensureBotUser(user, referral);
  // Touch the canonical row after upsert so recovered/legacy users are always visible in dashboard activity.
  void recordBotActivityById(account.id).catch((error) => console.error("[Telegram] canonical activity touch failed", error));
  if (command === "/start") {
    if (productDeepLink && /^\d+$/.test(productDeepLink)) {
      if (!(await requireAccess(message.chat.id, user.id))) return;
      return showProduct(message.chat.id, Number(productDeepLink));
    }
    if (referralsDeepLink) {
      if (!(await requireAccess(message.chat.id, user.id))) return;
      return showReferrals(message.chat.id, user.id);
    }
    return showHome(message.chat.id, user.id);
  }
  if (!(await requireAccess(message.chat.id, user.id))) return;
  if (command === "/shop") return showShop(message.chat.id);
  if (command === "/wallet") return showWallet(message.chat.id, user.id);
  if (command === "/orders") return showOrders(message.chat.id, user.id);
  if (command === "/profile") return showProfile(message.chat.id, user.id);
  if (command === "/support") {
    return showSupportMenu(message.chat.id);
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

export type TelegramBotIdentity = { id: number; is_bot: boolean; first_name: string; username?: string };

export async function getTelegramBotIdentity() {
  return telegramCall<TelegramBotIdentity>("getMe", {});
}

export async function configureTelegramWebhook(webhookUrl: string) {
  if (!/^https:\/\//i.test(webhookUrl)) throw new Error("Webhook URL must use HTTPS");
  const secret = validTelegramWebhookSecret(process.env.TELEGRAM_WEBHOOK_SECRET);
  await telegramCall("setWebhook", { url: webhookUrl, ...(secret ? { secret_token: secret } : {}) });
  return telegramCall<{ url: string; has_custom_certificate: boolean; pending_update_count: number; max_connections?: number; ip_address?: string; last_error_date?: number; last_error_message?: string }>("getWebhookInfo", {});
}

/**
 * Koyeb performs the one-time webhook migration from its non-USA runtime.
 * The hostname is intentionally fixed to the current Koyeb service so no
 * additional public configuration variable is required. The PORT guard keeps
 * the Manus deployment from redirecting Telegram back to Koyeb.
 */
export function isKoyebRuntime() {
  return process.env.NODE_ENV === "production" && process.env.PORT === "8000" && Boolean(process.env.PASS);
}

export async function configureKoyebWebhookOnStartup() {
  if (!isKoyebRuntime()) return null;
  const webhookUrl = "https://cognitive-quintilla-techzone3228-89a97258.koyeb.app/api/telegram/webhook";
  return configureTelegramWebhook(webhookUrl);
}

export async function telegramWebhookConfigure(req: Request, res: Response) {
  const expected = process.env.PASS;
  if (!expected || req.header("x-nebula-config-pass") !== expected) return res.status(401).json({ ok: false, error: "unauthorized" });
  try {
    const info = await configureKoyebWebhookOnStartup();
    if (!info) return res.status(409).json({ ok: false, error: "Koyeb startup registration is not enabled in this runtime" });
    return res.json({ ok: true, webhook: info });
  } catch (error) {
    return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Telegram unavailable" });
  }
}

export async function telegramWebhookHealth(_req: Request, res: Response) {
  if (!isKoyebRuntime()) return res.json({ ok: true, active: false, runtime: "manus-dashboard-only" });
  try {
    const [info, bot] = await Promise.all([
      telegramCall<{ url: string; pending_update_count: number; max_connections?: number; ip_address?: string; last_error_date?: number; last_error_message?: string }>("getWebhookInfo", {}),
      getTelegramBotIdentity(),
    ]);
    return res.json({ ok: true, active: true, runtime: "koyeb", bot: { id: bot.id, username: bot.username ?? null, first_name: bot.first_name }, webhook: info, diagnostics: telegramRuntimeDiagnostics() });
  } catch (error) {
    return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Telegram unavailable" });
  }
}

async function processTelegramWebhookUpdate(update: TelegramUpdate) {
  telegramUpdatesInFlight += 1;
  lastTelegramUpdate = { updateId: update.update_id, receivedAt: new Date().toISOString(), phase: "received" };
  try {
    if (!(await claimTelegramUpdate(update.update_id))) return;
    lastTelegramUpdate = { ...lastTelegramUpdate, phase: "processing" };
    const actorId = update.message?.from?.id ?? update.callback_query?.from.id;
  if (actorId && update.message) {
    const now = Date.now();
    const previous = recentRequests.get(actorId) ?? 0;
    if (now - previous < 350) return;
    recentRequests.set(actorId, now);
    // Do not make Telegram wait for this bookkeeping write.
    void recordBotActivity(actorId).catch((error) => console.error("[Telegram] activity touch failed", error));
  }
  if (update.pre_checkout_query) await handleStarsPreCheckout(update.pre_checkout_query);
  else if (update.callback_query) await handleCallback(update.callback_query);
  else if (update.message?.successful_payment) {
    if (update.message.successful_payment.invoice_payload.startsWith("toolsmania-wallet-stars:")) await verifyAndFulfillTelegramStarsWalletDeposit(update.message.chat.id, update.message.from?.id ?? 0, update.message.successful_payment);
    else await verifyAndFulfillTelegramStarsPurchase(update.message.chat.id, update.message.from?.id ?? 0, update.message.successful_payment);
  }
    else if (update.message) await handleMessage(update.message);
    lastTelegramUpdate = { ...lastTelegramUpdate, phase: "completed" };
  } finally {
    telegramUpdatesInFlight = Math.max(0, telegramUpdatesInFlight - 1);
  }
}

export async function telegramWebhookHandler(req: Request, res: Response) {
  if (!isKoyebRuntime()) return res.status(410).json({ ok: false, error: "Telegram runtime moved to Koyeb" });
  try {
    const configuredSecret = validTelegramWebhookSecret(process.env.TELEGRAM_WEBHOOK_SECRET);
    if (configuredSecret && req.header("x-telegram-bot-api-secret-token") !== configuredSecret) return res.status(401).json({ error: "invalid webhook secret" });
    const update = req.body as TelegramUpdate | undefined;

    // A Telegram webhook must be acknowledged quickly. Database access, Binance Pay
    // verification, and outbound notifications run after the 200 response so a slow
    // dependency cannot make Telegram report "Read timeout expired" and redeliver it.
    res.json({ ok: true });
    if (!update || typeof update.update_id !== "number") return;
    void processTelegramWebhookUpdate(update).catch((error) => {
      lastTelegramUpdate = { updateId: update.update_id, receivedAt: lastTelegramUpdate?.receivedAt ?? new Date().toISOString(), phase: "failed", reason: errorMessage(error) };
      recordTelegramFailure("webhook_update", error, updateContext(update));
    });
  } catch (error) {
    recordTelegramFailure("webhook_validation", error, { method: req.method, path: req.path });
    return res.status(500).json({ ok: false, error: errorMessage(error) });
  }
}

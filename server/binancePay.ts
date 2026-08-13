import { createHmac } from "node:crypto";

const BINANCE_API_BASE = "https://api.binance.com";
const PAY_TRANSACTIONS_ENDPOINT = "/sapi/v1/pay/transactions";
const PAY_TRANSACTION_LIMIT = 200;
const PAY_RECV_WINDOW = 60_000;
const SUPPORTED_ASSETS = new Set(["USDT", "USDC", "BUSD"]);

type BinancePayTransaction = {
  orderId?: string | number;
  transactionId?: string | number;
  amount?: string | number;
  currency?: string;
  asset?: string;
  status?: string;
  transactionTime?: number;
  time?: number;
  receiverInfo?: { name?: string; binanceId?: string | number };
};

type BinancePayResponse = { data?: BinancePayTransaction[]; code?: string; msg?: string };

function requireCredentials() {
  const apiKey = process.env.BINANCE_PAY_API_KEY;
  const secretKey = process.env.BINANCE_PAY_SECRET_KEY;
  if (!apiKey || !secretKey) throw new Error("Binance Pay credentials are not configured");
  return { apiKey, secretKey };
}

export function buildBinanceSignedQuery(params: Record<string, string | number>, secretKey: string, now = Date.now()) {
  const query = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
    timestamp: String(now),
    recvWindow: String(PAY_RECV_WINDOW),
  }).toString();
  const signature = createHmac("sha256", secretKey).update(query).digest("hex");
  return `${query}&signature=${signature}`;
}

async function requestPayTransactions(
  params: Record<string, string | number>,
  apiKey: string,
  secretKey: string,
  fetcher: typeof fetch,
) {
  const query = buildBinanceSignedQuery(params, secretKey);
  const response = await fetcher(`${BINANCE_API_BASE}${PAY_TRANSACTIONS_ENDPOINT}?${query}`, {
    headers: { "X-MBX-APIKEY": apiKey },
  });
  const payload = (await response.json()) as BinancePayResponse;
  if (!response.ok) throw new Error(payload.msg ?? `Binance API returned HTTP ${response.status}`);
  return payload.data ?? [];
}

async function getPayTransactions(apiKey: string, secretKey: string, fetcher: typeof fetch) {
  try {
    return await requestPayTransactions({ limit: PAY_TRANSACTION_LIMIT }, apiKey, secretKey, fetcher);
  } catch (primaryError) {
    try {
      return await requestPayTransactions({}, apiKey, secretKey, fetcher);
    } catch {
      throw primaryError;
    }
  }
}

function matchesSearchId(transaction: BinancePayTransaction, searchId: string) {
  const orderId = String(transaction.orderId ?? "");
  const transactionId = String(transaction.transactionId ?? "");
  return [orderId, transactionId].some((candidate) => candidate && (searchId === candidate || searchId.includes(candidate) || candidate.includes(searchId)));
}

function isExactMatch(transaction: BinancePayTransaction, searchId: string) {
  return String(transaction.orderId ?? "") === searchId || String(transaction.transactionId ?? "") === searchId;
}

export async function findBinancePayTransaction(searchId: string, expectedAmountCents?: number, fetcher: typeof fetch = fetch) {
  const normalizedId = searchId.trim();
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(normalizedId)) return { ok: false as const, reason: "invalid_id" as const };

  const { apiKey, secretKey } = requireCredentials();
  const transactions = await getPayTransactions(apiKey, secretKey, fetcher);
  const matches = transactions.filter((transaction) => matchesSearchId(transaction, normalizedId));
  const exactMatches = matches.filter((transaction) => isExactMatch(transaction, normalizedId));
  const candidates = exactMatches.length > 0 ? exactMatches : matches;

  if (candidates.length === 0) return { ok: false as const, reason: "not_found" as const };
  if (candidates.length > 1) return { ok: false as const, reason: "ambiguous_id" as const };

  const transaction = candidates[0];
  const amount = Number(transaction.amount);
  const asset = String(transaction.currency ?? transaction.asset ?? "").toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false as const, reason: "not_received" as const, transaction };
  if (!SUPPORTED_ASSETS.has(asset)) return { ok: false as const, reason: "unsupported_asset" as const, transaction };

  const amountCents = Math.round(amount * 100);
  if (expectedAmountCents !== undefined && amountCents !== expectedAmountCents) {
    return { ok: false as const, reason: "amount_mismatch" as const, transaction, amountCents, asset };
  }
  return { ok: true as const, transaction, amountCents, asset };
}

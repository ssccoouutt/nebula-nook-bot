import { createHmac } from "node:crypto";

const BINANCE_API_BASE = "https://api.binance.com";
const PAY_TRANSACTIONS_ENDPOINT = "/sapi/v1/pay/transactions";
const DEPOSIT_HISTORY_ENDPOINT = "/sapi/v1/capital/deposit/hisrec";
const PAY_TRANSACTION_LIMIT = 200;
const PAY_RECV_WINDOW = 60_000;
const REQUIRED_ASSET = "USDT";
const REQUIRED_NETWORK = "BSC";

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
type BinanceDeposit = { id?: string; txId?: string; transactionId?: string; amount?: string | number; coin?: string; network?: string; status?: number; address?: string; confirmTimes?: string };
type BinanceDepositResponse = { depositList?: BinanceDeposit[]; code?: string; msg?: string };

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

async function requestDepositHistory(params: Record<string, string | number>, apiKey: string, secretKey: string, fetcher: typeof fetch) {
  const query = buildBinanceSignedQuery(params, secretKey);
  const response = await fetcher(`${BINANCE_API_BASE}${DEPOSIT_HISTORY_ENDPOINT}?${query}`, { headers: { "X-MBX-APIKEY": apiKey } });
  const payload = (await response.json()) as BinanceDepositResponse;
  if (!response.ok) throw new Error(payload.msg ?? `Binance deposit API returned HTTP ${response.status}`);
  return payload.depositList ?? [];
}

export async function findBinancePayTransaction(searchId: string, expectedAmountCents?: number, fetcher: typeof fetch = fetch, paymentMethod: "binance_pay" | "bep20" = process.env.BEP20 ? "bep20" : "binance_pay") {
  const normalizedId = searchId.trim();
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(normalizedId)) return { ok: false as const, reason: "invalid_id" as const };

  const { apiKey, secretKey } = requireCredentials();
  const bep20Address = process.env.BEP20?.trim();
  if (paymentMethod === "bep20") {
    const deposits = await requestDepositHistory({ coin: REQUIRED_ASSET, network: REQUIRED_NETWORK, limit: PAY_TRANSACTION_LIMIT }, apiKey, secretKey, fetcher);
    const matching = deposits.filter((deposit) => String(deposit.txId ?? "") === normalizedId);
    if (matching.length === 0) return { ok: false as const, reason: "not_found" as const };
    if (matching.length > 1) return { ok: false as const, reason: "ambiguous_id" as const };
    const deposit = matching[0];
    const transaction = { ...deposit, transactionId: deposit.txId };
    const asset = String(deposit.coin ?? "").toUpperCase();
    const network = String(deposit.network ?? "").toUpperCase();
    const amount = Number(deposit.amount);
    if (asset !== REQUIRED_ASSET) return { ok: false as const, reason: "unsupported_asset" as const, transaction };
    if (network !== REQUIRED_NETWORK && network !== "BEP20") return { ok: false as const, reason: "unsupported_network" as const, transaction };
    if (String(deposit.address ?? "") !== bep20Address) return { ok: false as const, reason: "address_mismatch" as const, transaction };
    if (deposit.status !== undefined && deposit.status !== 1) return { ok: false as const, reason: "not_received" as const, transaction };
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false as const, reason: "not_received" as const, transaction };
    const amountCents = Math.round(amount * 100);
    if (expectedAmountCents !== undefined && amountCents !== expectedAmountCents) return { ok: false as const, reason: "amount_mismatch" as const, transaction, amountCents, asset };
    return { ok: true as const, transaction, amountCents, asset };
  }
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
  if (asset !== REQUIRED_ASSET) return { ok: false as const, reason: "unsupported_asset" as const, transaction };

  const amountCents = Math.round(amount * 100);
  if (expectedAmountCents !== undefined && amountCents !== expectedAmountCents) {
    return { ok: false as const, reason: "amount_mismatch" as const, transaction, amountCents, asset };
  }
  return { ok: true as const, transaction, amountCents, asset };
}

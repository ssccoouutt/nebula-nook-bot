import { createHmac } from "node:crypto";

const BINANCE_API_BASE = "https://api.binance.com";
const PAY_TRANSACTIONS_ENDPOINT = "/sapi/v1/pay/transactions";
const PAY_RECV_WINDOW = 60_000;
const PAY_TRANSACTION_LIMIT = 200;
const REQUIRED_ASSET = "USDT";
const REQUIRED_NETWORK = "BSC";
const BSC_USDT_CONTRACT = "0x55d398326f99059ff775485246999027b3197955";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const BSC_RPC_ENDPOINTS = [
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc-dataseed1.ninicoin.io",
];
const BSC_MIN_CONFIRMATIONS = 1;

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
type RpcResponse<T> = { result?: T; error?: { message?: string } };
type BscLog = { address?: string; topics?: string[]; data?: string; removed?: boolean };
type BscReceipt = { status?: string; blockNumber?: string; to?: string; logs?: BscLog[] };
type BscBlock = { number?: string; timestamp?: string };

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

function normalizeAddress(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function hexToBigInt(value: string | undefined) {
  if (!value || !/^0x[0-9a-f]+$/i.test(value)) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function topicAddress(topic: string | undefined) {
  if (!topic || !/^0x[0-9a-f]{64}$/i.test(topic)) return "";
  return `0x${topic.slice(-40)}`.toLowerCase();
}

function rpcNumber(value: string | undefined) {
  const parsed = hexToBigInt(value);
  return parsed === undefined ? undefined : Number(parsed);
}

async function requestBscRpc<T>(method: string, params: unknown[], fetcher: typeof fetch) {
  let lastError: unknown;
  for (const endpoint of BSC_RPC_ENDPOINTS) {
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const payload = (await response.json()) as RpcResponse<T>;
      if (!response.ok || payload.error || payload.result === undefined) {
        throw new Error(payload.error?.message ?? `BSC RPC returned HTTP ${response.status}`);
      }
      return payload.result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("BSC RPC unavailable");
}

async function findBep20Transfer(txHash: string, expectedAmountCents: number | undefined, fetcher: typeof fetch, notBeforeMs?: number) {
  const [receipt, latestBlock] = await Promise.all([
    requestBscRpc<BscReceipt | null>("eth_getTransactionReceipt", [txHash], fetcher),
    requestBscRpc<BscBlock>("eth_getBlockByNumber", ["latest", false], fetcher),
  ]);
  if (!receipt || receipt.status !== "0x1" || !receipt.blockNumber) return { ok: false as const, reason: "not_received" as const };

  const receiptBlock = rpcNumber(receipt.blockNumber);
  const currentBlock = rpcNumber(latestBlock.number);
  if (receiptBlock === undefined || currentBlock === undefined || currentBlock - receiptBlock + 1 < BSC_MIN_CONFIRMATIONS) {
    return { ok: false as const, reason: "not_received" as const };
  }
  if (notBeforeMs !== undefined) {
    const transactionBlock = await requestBscRpc<BscBlock>("eth_getBlockByNumber", [receipt.blockNumber, false], fetcher);
    const transactionTimestamp = rpcNumber(transactionBlock.timestamp);
    if (transactionTimestamp === undefined || transactionTimestamp * 1000 <= notBeforeMs) {
      return { ok: false as const, reason: "before_invoice" as const };
    }
  }

  const configuredAddress = normalizeAddress(process.env.BEP20);
  const transfer = (receipt.logs ?? []).find((log) => {
    const topics = log.topics ?? [];
    return !log.removed && normalizeAddress(log.address) === BSC_USDT_CONTRACT && topics[0]?.toLowerCase() === TRANSFER_TOPIC && topicAddress(topics[2]) === configuredAddress;
  });
  if (!transfer) return { ok: false as const, reason: "address_mismatch" as const };

  const rawAmount = hexToBigInt(transfer.data);
  if (rawAmount === undefined || rawAmount <= BigInt(0)) return { ok: false as const, reason: "not_received" as const };
  const amountCents = Number((rawAmount * BigInt(100)) / BigInt("1000000000000000000"));
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return { ok: false as const, reason: "not_received" as const };
  if (expectedAmountCents !== undefined && amountCents !== expectedAmountCents) {
    return { ok: false as const, reason: "amount_mismatch" as const, amountCents, asset: REQUIRED_ASSET };
  }
  return { ok: true as const, transaction: { txId: txHash, transactionId: txHash, amount: amountCents / 100, coin: REQUIRED_ASSET, network: REQUIRED_NETWORK, address: process.env.BEP20, status: "SUCCESS" }, amountCents, asset: REQUIRED_ASSET };
}

export async function findBinancePayTransaction(searchId: string, expectedAmountCents?: number, fetcher: typeof fetch = fetch, paymentMethod: "binance_pay" | "bep20" = process.env.BEP20 ? "bep20" : "binance_pay", notBeforeMs?: number) {
  const normalizedId = searchId.trim();
  if (!/^(?:0x)?[A-Za-z0-9_-]{6,128}$/.test(normalizedId)) return { ok: false as const, reason: "invalid_id" as const };

  if (paymentMethod === "bep20") {
    if (!process.env.BEP20?.trim()) return { ok: false as const, reason: "address_mismatch" as const };
    return findBep20Transfer(normalizedId, expectedAmountCents, fetcher, notBeforeMs);
  }

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
  if (asset !== REQUIRED_ASSET) return { ok: false as const, reason: "unsupported_asset" as const, transaction };

  const amountCents = Math.round(amount * 100);
  if (expectedAmountCents !== undefined && amountCents !== expectedAmountCents) {
    return { ok: false as const, reason: "amount_mismatch" as const, transaction, amountCents, asset };
  }
  return { ok: true as const, transaction, amountCents, asset };
}

export const bep20VerificationConstants = {
  usdtContract: BSC_USDT_CONTRACT,
  minConfirmations: BSC_MIN_CONFIRMATIONS,
};

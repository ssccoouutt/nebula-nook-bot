import { createHmac } from "node:crypto";

const BINANCE_API_BASE = "https://api.binance.com";

type BinancePayTransaction = {
  transactionId?: string;
  amount?: string | number;
  asset?: string;
  status?: string;
  time?: number;
  receiverInfo?: { name?: string };
};

type BinancePayResponse = { data?: BinancePayTransaction[]; code?: string; msg?: string };

function requireCredentials() {
  const apiKey = process.env.BINANCE_PAY_API_KEY;
  const secretKey = process.env.BINANCE_PAY_SECRET_KEY;
  if (!apiKey || !secretKey) throw new Error("Binance Pay credentials are not configured");
  return { apiKey, secretKey };
}

export function buildBinanceSignedQuery(params: Record<string, string | number>, secretKey: string, now = Date.now()) {
  const query = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])), timestamp: String(now), recvWindow: "5000" }).toString();
  const signature = createHmac("sha256", secretKey).update(query).digest("hex");
  return `${query}&signature=${signature}`;
}

export async function findBinancePayTransaction(transactionId: string, expectedAmountCents?: number, fetcher: typeof fetch = fetch) {
  const normalizedId = transactionId.trim();
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(normalizedId)) return { ok: false as const, reason: "invalid_id" as const };
  const { apiKey, secretKey } = requireCredentials();
  const query = buildBinanceSignedQuery({ transactionId: normalizedId }, secretKey);
  const response = await fetcher(`${BINANCE_API_BASE}/sapi/v1/pay/transactions?${query}`, { headers: { "X-MBX-APIKEY": apiKey } });
  const payload = (await response.json()) as BinancePayResponse;
  if (!response.ok) throw new Error(payload.msg ?? `Binance API returned HTTP ${response.status}`);
  const tx = payload.data?.find((item) => String(item.transactionId) === normalizedId);
  if (!tx) return { ok: false as const, reason: "not_found" as const };
  const amount = Number(tx.amount);
  const asset = String(tx.asset ?? "").toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false as const, reason: "not_received" as const, transaction: tx };
  if (!new Set(["USDT", "USDC", "BUSD"]).has(asset)) return { ok: false as const, reason: "unsupported_asset" as const, transaction: tx };
  const amountCents = Math.round(amount * 100);
  if (expectedAmountCents !== undefined && amountCents !== expectedAmountCents) return { ok: false as const, reason: "amount_mismatch" as const, transaction: tx, amountCents, asset };
  return { ok: true as const, transaction: tx, amountCents, asset };
}

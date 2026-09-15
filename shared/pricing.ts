export type BulkPricingTier = {
  minQuantity: number;
  maxQuantity: number | null;
  unitPriceCents: number;
};

function normalizeBulkLines(value: string | null | undefined) {
  return String(value ?? "")
    .replaceAll("\\n", "\n")
    .replaceAll("→", ":")
    .replaceAll("=>", ":")
    .split(/[\r\n;,]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[•\-*]\s*/, "").replace(/\s+codes?\b/gi, "").replace(/\s+each\b/gi, "").trim());
}

export function parseBulkPricing(value: string | null | undefined): BulkPricingTier[] {
  const lines = normalizeBulkLines(value);
  const tiers = lines.map((line) => {
    const match = line.match(/^(\d+)(?:\s*-\s*(\d+)|\s*\+)\s*:?\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)$/);
    if (!match) throw new Error("Bulk pricing must use one tier per line, for example 5-9:0.90 or 10+:0.80");
    const minQuantity = Number(match[1]);
    const maxQuantity = match[2] === undefined ? null : Number(match[2]);
    const unitPriceCents = Math.round(Number(match[3]) * 100);
    if (!Number.isSafeInteger(minQuantity) || minQuantity < 1 || (maxQuantity !== null && (!Number.isSafeInteger(maxQuantity) || maxQuantity < minQuantity)) || !Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) {
      throw new Error("Bulk pricing tiers must have valid positive quantities and non-negative prices");
    }
    return { minQuantity, maxQuantity, unitPriceCents };
  }).sort((a, b) => a.minQuantity - b.minQuantity);
  for (let index = 1; index < tiers.length; index += 1) {
    const previous = tiers[index - 1];
    if (previous.maxQuantity === null || tiers[index].minQuantity <= previous.maxQuantity) throw new Error("Bulk pricing tiers cannot overlap");
  }
  return tiers;
}

export function normalizeBulkPricing(value: string | null | undefined) {
  return parseBulkPricing(value).map((tier) => `${tier.minQuantity}${tier.maxQuantity === null ? "+" : `-${tier.maxQuantity}`}:${(tier.unitPriceCents / 100).toFixed(2)}`).join("\n");
}

export function resolveBulkUnitPriceCents(basePriceCents: number, bulkPricing: string | null | undefined, quantity: number) {
  const safeQuantity = Math.max(1, Math.floor(quantity));
  let tiers: BulkPricingTier[] = [];
  try {
    tiers = parseBulkPricing(bulkPricing);
  } catch {
    return basePriceCents;
  }
  const tier = tiers.find((item) => safeQuantity >= item.minQuantity && (item.maxQuantity === null || safeQuantity <= item.maxQuantity));
  return tier?.unitPriceCents ?? basePriceCents;
}

export function formatBulkPricingForUsers(bulkPricing: string | null | undefined, availableStock?: number) {
  let tiers: BulkPricingTier[] = [];
  try {
    tiers = parseBulkPricing(bulkPricing);
  } catch {
    return "";
  }
  return tiers.filter((tier) => availableStock === undefined || availableStock >= tier.minQuantity).map((tier) => `• ${tier.minQuantity}${tier.maxQuantity === null ? "+" : `-${tier.maxQuantity}`} codes → $${(tier.unitPriceCents / 100).toFixed(2)} each`).join("\n");
}

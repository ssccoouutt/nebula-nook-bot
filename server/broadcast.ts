export function normalizeBroadcastRecipients(values: readonly (number | null | undefined)[]) {
  return Array.from(new Set(values.filter((value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0)));
}

export function broadcastDeliveryLabel(sentCount: number, failedCount: number) {
  return `${Math.max(0, sentCount)} sent, ${Math.max(0, failedCount)} failed`;
}

export type OrderHistorySnapshotInput = {
  deliveredItem?: string | null;
  purchaseWarranty?: string | null;
  quantity?: number | null;
  paymentMethod?: string | null;
  legacyWarranty?: string | null;
  legacyPaymentMethod: string;
};

export function resolveOrderHistorySnapshot(input: OrderHistorySnapshotInput) {
  return {
    deliveredItem: input.deliveredItem ?? "",
    warranty: input.purchaseWarranty ?? input.legacyWarranty ?? "",
    quantity: input.quantity ?? 1,
    paymentMethod: input.paymentMethod ?? input.legacyPaymentMethod,
  };
}

export function orderHistorySearchText(input: {
  userName: string;
  username: string;
  telegramUserId: number | null;
  productName: string;
  deliveredItem: string;
  warranty: string;
  paymentMethod: string;
  id: number;
  kind: string;
}) {
  return `${input.userName} ${input.username} ${input.telegramUserId ?? ""} ${input.productName} ${input.deliveredItem} ${input.warranty} ${input.paymentMethod} ${input.id} ${input.kind}`.toLowerCase();
}

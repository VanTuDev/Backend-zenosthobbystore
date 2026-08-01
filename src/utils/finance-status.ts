import type { PaymentStatus } from "../models/order.model";

/** Maps an order's paymentStatus to the linked FinanceTransaction's status, so /finance/summary and /finance/stats always agree with the order that produced them. */
export function financeStatusFor(paymentStatus: PaymentStatus) {
  if (paymentStatus === "paid") return "completed";
  if (paymentStatus === "refunded") return "failed";
  return "pending";
}

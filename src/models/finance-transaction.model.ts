import { Schema, model, Types } from "mongoose";
import { applyJsonTransform } from "./plugin";

export type TransactionType = "revenue" | "refund" | "payout";
export type TransactionStatus = "completed" | "pending" | "failed";

export interface FinanceTransactionDoc {
  customer: string;
  date: Date;
  amount: number;
  type: TransactionType;
  method: string;
  status: TransactionStatus;
  orderId: Types.ObjectId | null;
}

const financeTransactionSchema = new Schema<FinanceTransactionDoc>({
  customer: { type: String, required: true },
  date: { type: Date, default: Date.now },
  amount: { type: Number, required: true },
  type: { type: String, enum: ["revenue", "refund", "payout"], required: true },
  method: { type: String, required: true },
  status: { type: String, enum: ["completed", "pending", "failed"], default: "completed" },
  orderId: { type: Schema.Types.ObjectId, ref: "Order", default: null },
});

applyJsonTransform(financeTransactionSchema);

export const FinanceTransaction = model<FinanceTransactionDoc>(
  "FinanceTransaction",
  financeTransactionSchema,
);

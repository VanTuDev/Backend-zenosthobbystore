import { Router } from "express";
import { z } from "zod";
import { attachUser, requireAdmin } from "../middleware/auth";
import { requireDb } from "../middleware/require-db";
import { FinanceTransaction } from "../models/finance-transaction.model";
import { ApiError } from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";
import { getPagination, paginatedResponse } from "../utils/pagination";

export const financeRouter = Router();

financeRouter.use(requireDb, attachUser, requireAdmin);

const transactionSchema = z.object({
  customer: z.string().min(1),
  amount: z.number().int(),
  type: z.enum(["revenue", "refund", "payout"]),
  method: z.enum(["Chuyển khoản", "COD", "Thẻ tín dụng", "Ví điện tử"]),
  status: z.enum(["completed", "pending", "failed"]).default("completed"),
  orderId: z.string().nullable().optional(),
});

financeRouter.get(
  "/transactions",
  asyncHandler(async (req, res) => {
    const { type, status } = req.query as Record<string, string | undefined>;
    const pagination = getPagination(req);
    const filter = { ...(type ? { type } : {}), ...(status ? { status } : {}) };

    const [transactions, total] = await Promise.all([
      FinanceTransaction.find(filter).sort({ date: -1 }).skip(pagination.skip).limit(pagination.pageSize),
      FinanceTransaction.countDocuments(filter),
    ]);

    res.json(paginatedResponse(transactions, total, pagination));
  }),
);

financeRouter.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    const rows = await FinanceTransaction.aggregate<{ _id: string; total: number }>([
      { $match: { status: "completed" } },
      { $group: { _id: "$type", total: { $sum: "$amount" } } },
    ]);
    const byType = Object.fromEntries(rows.map((r) => [r._id, r.total]));
    const revenue = byType.revenue ?? 0;
    const refunds = byType.refund ?? 0;
    const payouts = byType.payout ?? 0;
    res.json({ revenue, refunds, payouts, net: revenue - refunds - payouts });
  }),
);

financeRouter.post(
  "/transactions",
  asyncHandler(async (req, res) => {
    const body = transactionSchema.parse(req.body);
    const transaction = await FinanceTransaction.create(body);
    res.status(201).json({ transaction });
  }),
);

financeRouter.delete(
  "/transactions/:id",
  asyncHandler(async (req, res) => {
    const existing = await FinanceTransaction.findByIdAndDelete(req.params.id);
    if (!existing) throw ApiError.notFound("Không tìm thấy giao dịch.");
    res.status(204).end();
  }),
);

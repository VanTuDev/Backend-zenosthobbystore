import { Router } from "express";
import { z } from "zod";
import { attachUser, requireAdmin } from "../middleware/auth";
import { requireDb } from "../middleware/require-db";
import { FinanceTransaction } from "../models/finance-transaction.model";
import { Order } from "../models/order.model";
import { ApiError } from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";
import { getPagination, paginatedResponse } from "../utils/pagination";

const STATS_WINDOWS = [7, 30, 90] as const;
type StatsWindow = (typeof STATS_WINDOWS)[number];

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

/**
 * Order/revenue statistics for the admin Finance dashboard, scoped to a rolling window
 * (default 30 days). Aggregated directly off `Order` (not FinanceTransaction) so the
 * numbers always tie back to real orders regardless of transaction-sync edge cases.
 */
financeRouter.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const requested = Number(req.query.days);
    const days: StatsWindow = STATS_WINDOWS.includes(requested as StatsWindow)
      ? (requested as StatsWindow)
      : 30;

    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (days - 1));

    const windowMatch = { placedAt: { $gte: since }, status: { $ne: "cancelled" } };

    const [revenueRows, statusRows, topProductRows, totalsRows] = await Promise.all([
      Order.aggregate<{ _id: string; revenue: number; orders: number }>([
        { $match: windowMatch },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$placedAt" } },
            revenue: { $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$total", 0] } },
            orders: { $sum: 1 },
          },
        },
      ]),
      Order.aggregate<{ _id: string; count: number }>([
        { $match: windowMatch },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Order.aggregate<{ _id: string; name: string; image: string; quantity: number; revenue: number }>([
        { $match: windowMatch },
        { $unwind: "$items" },
        {
          $group: {
            _id: { $ifNull: ["$items.productId", "$items.slug"] },
            name: { $last: "$items.name" },
            image: { $last: "$items.image" },
            quantity: { $sum: "$items.quantity" },
            revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 },
      ]),
      Order.aggregate<{ totalOrders: number; totalRevenue: number; customerIds: unknown[] }>([
        { $match: windowMatch },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalRevenue: { $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$total", 0] } },
            customerIds: { $addToSet: "$userId" },
          },
        },
      ]),
    ]);

    // Fill in zero-revenue days so the chart always renders a full, contiguous window.
    const revenueByDate = new Map(revenueRows.map((r) => [r._id, r]));
    const revenueSeries = Array.from({ length: days }, (_, i) => {
      const date = new Date(since);
      date.setDate(date.getDate() + i);
      const key = date.toISOString().slice(0, 10);
      const row = revenueByDate.get(key);
      return { date: key, revenue: row?.revenue ?? 0, orders: row?.orders ?? 0 };
    });

    const totalsRow = totalsRows[0];
    const totalOrders = totalsRow?.totalOrders ?? 0;
    const totalRevenue = totalsRow?.totalRevenue ?? 0;
    const totalCustomers = totalsRow ? totalsRow.customerIds.filter(Boolean).length : 0;

    res.json({
      days,
      revenueSeries,
      ordersByStatus: statusRows.map((r) => ({ status: r._id, count: r.count })),
      topProducts: topProductRows.map((r) => ({
        productId: r._id,
        name: r.name,
        image: r.image,
        quantity: r.quantity,
        revenue: r.revenue,
      })),
      totals: {
        totalOrders,
        totalRevenue,
        totalCustomers,
        aov: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
      },
    });
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

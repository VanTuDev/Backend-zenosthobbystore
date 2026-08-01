import crypto from "node:crypto";
import { Router } from "express";
import { attachUser, requireAuth } from "../middleware/auth";
import { requireDb } from "../middleware/require-db";
import { FinanceTransaction } from "../models/finance-transaction.model";
import { Order } from "../models/order.model";
import { ApiError } from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";
import { financeStatusFor } from "../utils/finance-status";

/**
 * Simulated PayOS integration — no real gateway/keys involved. "Create" mints a fake
 * payment ref + QR payload for the frontend to render as a placeholder; "confirm" plays
 * the role PayOS's webhook would play in production, flipping the order to paid and
 * syncing its FinanceTransaction the same way the admin's manual payment-status PATCH does.
 */
export const paymentsRouter = Router();
paymentsRouter.use(requireDb, attachUser, requireAuth);

async function loadOwnedOrder(orderId: string, userId: string, role: string) {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound("Không tìm thấy đơn hàng.");
  const isOwner = order.userId && String(order.userId) === userId;
  if (!isOwner && role !== "ADMIN") throw ApiError.forbidden("Bạn không có quyền thao tác trên đơn hàng này.");
  return order;
}

paymentsRouter.post(
  "/payos/:orderId",
  asyncHandler(async (req, res) => {
    const order = await loadOwnedOrder(req.params.orderId, req.user!.sub, req.user!.role);
    if (order.paymentStatus !== "unpaid") {
      throw ApiError.badRequest("Đơn hàng này không ở trạng thái chờ thanh toán.");
    }

    const paymentRef = `PAYOS-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    order.paymentProvider = "payos";
    order.paymentRef = paymentRef;
    await order.save();

    res.status(201).json({
      orderId: order.id,
      paymentRef,
      amount: order.total,
      qrPayload: `ZENOS|PAYOS|${paymentRef}|${order.total}`,
    });
  }),
);

paymentsRouter.post(
  "/payos/:orderId/confirm",
  asyncHandler(async (req, res) => {
    const order = await loadOwnedOrder(req.params.orderId, req.user!.sub, req.user!.role);
    if (order.paymentStatus === "paid") {
      res.json({ order });
      return;
    }
    if (order.paymentProvider !== "payos" || !order.paymentRef) {
      throw ApiError.badRequest("Đơn hàng này chưa được khởi tạo thanh toán PayOS.");
    }

    order.paymentStatus = "paid";
    order.paidAt = new Date();
    await order.save();

    await FinanceTransaction.findOneAndUpdate(
      { orderId: order.id },
      { status: financeStatusFor(order.paymentStatus) },
    );

    res.json({ order });
  }),
);

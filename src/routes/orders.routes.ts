import { Router } from "express";
import { z } from "zod";
import { attachUser, requireAdmin, requireAuth } from "../middleware/auth";
import { requireDb } from "../middleware/require-db";
import { FinanceTransaction } from "../models/finance-transaction.model";
import { Order } from "../models/order.model";
import { Promotion } from "../models/promotion.model";
import { ApiError } from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";
import { financeStatusFor } from "../utils/finance-status";
import { getPagination, paginatedResponse } from "../utils/pagination";

export const ordersRouter = Router();
ordersRouter.use(requireDb);

const orderItemSchema = z.object({
  productId: z.string().optional(),
  slug: z.string().default(""),
  name: z.string().min(1),
  image: z.string().default(""),
  price: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
});

const orderSchema = z.object({
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  phone: z.string().min(1),
  provinceCode: z.string().min(1),
  provinceName: z.string().min(1),
  wardCode: z.string().min(1),
  wardName: z.string().min(1),
  addressDetail: z.string().min(1),
  items: z.array(orderItemSchema).min(1),
  shippingFee: z.number().int().nonnegative().default(0),
  tax: z.number().int().nonnegative().optional(),
  promotionCode: z.string().trim().min(1).optional(),
  paymentMethod: z.enum(["Chuyển khoản", "COD", "Thẻ tín dụng", "Ví điện tử"]),
  paymentStatus: z.enum(["paid", "unpaid", "refunded"]).default("unpaid"),
});

const statusSchema = z.object({
  status: z.enum(["pending", "processing", "shipped", "delivered", "cancelled"]),
});

const paymentStatusSchema = z.object({
  paymentStatus: z.enum(["paid", "unpaid", "refunded"]),
});

/**
 * Any signed-in user can place an order (checkout flow). Totals are always
 * recomputed here from `items` rather than trusted from the client, so a
 * tampered request body can't under-charge or skew reported revenue.
 */
ordersRouter.post(
  "/",
  attachUser,
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = orderSchema.parse(req.body);

    const subtotal = body.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    // Discount is never trusted from the client — only a real, currently-valid Promotion
    // code can produce one, computed here from the server-recomputed subtotal.
    let discount = 0;
    let promotion: InstanceType<typeof Promotion> | null = null;
    if (body.promotionCode) {
      const code = body.promotionCode.toUpperCase();
      promotion = await Promotion.findOne({ code });
      if (!promotion) throw ApiError.badRequest("Mã khuyến mãi không tồn tại.");

      const now = new Date();
      const isValid =
        promotion.status === "active" &&
        now >= promotion.startDate &&
        now <= promotion.endDate &&
        (promotion.usageLimit === 0 || promotion.usageCount < promotion.usageLimit);
      if (!isValid) throw ApiError.badRequest("Mã khuyến mãi không hợp lệ hoặc đã hết hạn.");
      if (promotion.type === "bundle") {
        throw ApiError.badRequest("Khuyến mãi tặng kèm chưa được hỗ trợ khi đặt hàng, vui lòng liên hệ CSKH.");
      }

      discount =
        promotion.type === "percentage"
          ? Math.round(subtotal * (promotion.value / 100))
          : Math.min(subtotal, promotion.value);
    }

    const total = subtotal + body.shippingFee + (body.tax ?? 0) - discount;
    if (total < 0) throw ApiError.badRequest("Tổng đơn hàng không hợp lệ.");

    // Strip a trailing comma the customer may have typed in addressDetail — otherwise it
    // doubles up with the separator here (e.g. "123 Main St," + ", " -> "123 Main St,, ...").
    const addressDetail = body.addressDetail.trim().replace(/[,\s]+$/, "");
    const shippingAddress = `${addressDetail}, ${body.wardName}, ${body.provinceName}`;

    const order = await Order.create({
      customerName: body.customerName,
      customerEmail: body.customerEmail,
      phone: body.phone,
      provinceCode: body.provinceCode,
      provinceName: body.provinceName,
      wardCode: body.wardCode,
      wardName: body.wardName,
      addressDetail,
      shippingAddress,
      items: body.items,
      subtotal,
      shippingFee: body.shippingFee,
      tax: body.tax,
      discount,
      total,
      paymentMethod: body.paymentMethod,
      paymentStatus: body.paymentStatus,
      userId: req.user!.sub,
      promotionCode: promotion?.code ?? null,
      promotionId: promotion?.id ?? null,
    });

    if (promotion) {
      await Promotion.updateOne({ _id: promotion.id }, { $inc: { usageCount: 1 } });
    }

    await FinanceTransaction.create({
      orderId: order.id,
      customer: order.customerName,
      amount: order.total,
      type: "revenue",
      method: order.paymentMethod,
      status: financeStatusFor(order.paymentStatus),
    });

    res.status(201).json({ order });
  }),
);

ordersRouter.use(attachUser);

/**
 * A signed-in customer can fetch their own order (order-confirmation page,
 * order history); an admin can fetch any order. Changing status/payment-status
 * and deleting stay admin-only below.
 */
ordersRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id);
    if (!order) throw ApiError.notFound("Không tìm thấy đơn hàng.");

    const isOwner = order.userId && String(order.userId) === req.user!.sub;
    if (!isOwner && req.user!.role !== "ADMIN") {
      throw ApiError.forbidden("Bạn không có quyền xem đơn hàng này.");
    }

    res.json({ order });
  }),
);

/**
 * An admin gets every order (optionally filtered by status). A regular customer gets the
 * same endpoint but scoped to their own orders — this is what powers the "Đơn hàng của tôi" page.
 */
ordersRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { status } = req.query as Record<string, string | string[] | undefined>;
    const pagination = getPagination(req);
    const statuses = Array.isArray(status) ? status : status ? [status] : [];
    const statusFilter =
      statuses.length === 0 ? {} : statuses.length === 1 ? { status: statuses[0] } : { status: { $in: statuses } };
    const filter = req.user!.role === "ADMIN" ? statusFilter : { ...statusFilter, userId: req.user!.sub };

    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ placedAt: -1 }).skip(pagination.skip).limit(pagination.pageSize),
      Order.countDocuments(filter),
    ]);

    res.json(paginatedResponse(orders, total, pagination));
  }),
);

ordersRouter.patch(
  "/:id/status",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { status } = statusSchema.parse(req.body);
    const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!order) throw ApiError.notFound("Không tìm thấy đơn hàng.");
    res.json({ order });
  }),
);

ordersRouter.patch(
  "/:id/payment-status",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { paymentStatus } = paymentStatusSchema.parse(req.body);
    const order = await Order.findByIdAndUpdate(req.params.id, { paymentStatus }, { new: true });
    if (!order) throw ApiError.notFound("Không tìm thấy đơn hàng.");

    // Keep the linked FinanceTransaction in sync so /finance/summary revenue stays correct.
    await FinanceTransaction.findOneAndUpdate(
      { orderId: order.id },
      { status: financeStatusFor(paymentStatus) },
    );

    res.json({ order });
  }),
);

ordersRouter.delete(
  "/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const existing = await Order.findByIdAndDelete(req.params.id);
    if (!existing) throw ApiError.notFound("Không tìm thấy đơn hàng.");
    // Otherwise the linked transaction survives as an orphan and keeps inflating /finance/summary forever.
    await FinanceTransaction.deleteOne({ orderId: existing.id });
    res.status(204).end();
  }),
);

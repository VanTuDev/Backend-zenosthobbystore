import { randomInt } from "node:crypto";
import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { attachUser, requireAdmin, requireAuth } from "../middleware/auth";
import { requireDb } from "../middleware/require-db";
import { FinanceTransaction } from "../models/finance-transaction.model";
import { FactoryOrderQuantity } from "../models/factory-order-quantity.model";
import { Order, type OrderItemDoc, type OrderStatus, type OrderType } from "../models/order.model";
import { ApiError } from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";
import { financeStatusFor } from "../utils/finance-status";
import { getPagination, paginatedResponse } from "../utils/pagination";

export const ordersRouter = Router();
ordersRouter.use(requireDb);

const ALL_STATUSES = [
  "packing",
  "deposit_received",
  "factory_ordered",
  "factory_shipped",
  "transit_warehouse",
  "vietnam_warehouse",
  "shop_warehouse",
  "shipped",
  "pending",
  "processing",
  "delivered",
  "cancelled",
] as const;

const STATUS_BY_TYPE: Record<OrderType, readonly OrderStatus[]> = {
  in_stock: ["packing", "shipped"],
  pre_order: [
    "deposit_received",
    "factory_ordered",
    "factory_shipped",
    "transit_warehouse",
    "vietnam_warehouse",
    "shop_warehouse",
    "shipped",
  ],
};

const orderItemSchema = z.object({
  productId: z.string().nullable().optional().refine((value) => !value || Types.ObjectId.isValid(value), "Mã sản phẩm không hợp lệ."),
  slug: z.string().default(""),
  name: z.string().min(1),
  variantName: z.string().trim().default(""),
  image: z.string().default(""),
  price: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  itemStatus: z.enum(ALL_STATUSES).optional(),
});

const createManualOrderSchema = z.object({
  orderType: z.enum(["in_stock", "pre_order"]),
  facebookName: z.string().trim().min(1),
  facebookUrl: z.string().trim().url(),
  phone: z.string().trim().default(""),
  addressDetail: z.string().trim().default(""),
  items: z.array(orderItemSchema).min(1),
  total: z.number().int().nonnegative().optional(),
  depositAmount: z.number().int().nonnegative().default(0),
});

const statusSchema = z.object({
  status: z.enum(ALL_STATUSES),
  trackingCode: z.string().trim().max(100).optional(),
});

const paymentStatusSchema = z.object({
  paymentStatus: z.enum(["not_deposited", "deposited", "paid"]),
});

const detailsSchema = z.object({
  orderType: z.enum(["in_stock", "pre_order"]).optional(),
  facebookName: z.string().trim().min(1).optional(),
  facebookUrl: z.string().trim().url().optional(),
  phone: z.string().trim().optional(),
  addressDetail: z.string().trim().optional(),
  total: z.number().int().nonnegative().optional(),
  depositAmount: z.number().int().nonnegative().optional(),
});

const itemStatusSchema = z.object({ status: z.enum(ALL_STATUSES) });

const splitOrderSchema = z.object({
  selections: z.array(z.object({ itemIndex: z.number().int().nonnegative(), quantity: z.number().int().positive() })).min(1),
  newTotal: z.number().int().nonnegative(),
  newDepositAmount: z.number().int().nonnegative(),
  originalTotal: z.number().int().nonnegative(),
  originalDepositAmount: z.number().int().nonnegative(),
});

const PUBLIC_CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomPublicCode() {
  return Array.from({ length: 6 }, () => PUBLIC_CODE_ALPHABET[randomInt(PUBLIC_CODE_ALPHABET.length)]).join("");
}

function paymentStatusForAmounts(depositAmount: number, total: number) {
  if (total > 0 && depositAmount >= total) return "paid" as const;
  if (depositAmount > 0) return "deposited" as const;
  return "not_deposited" as const;
}

function normalizeLegacyPaymentStatus<T extends { paymentStatus: string; depositAmount?: number; total: number }>(order: T) {
  if (order.paymentStatus === "unpaid") {
    order.paymentStatus = paymentStatusForAmounts(order.depositAmount ?? 0, order.total);
  }
  return order;
}

function earliestItemStatus(order: { orderType?: OrderType; status: OrderStatus; items: Array<{ itemStatus?: OrderStatus }> }) {
  const type = order.orderType ?? "in_stock";
  const sequence = STATUS_BY_TYPE[type];
  let earliestIndex = sequence.length - 1;
  let found = false;
  for (const item of order.items) {
    const index = sequence.indexOf(item.itemStatus ?? order.status);
    if (index >= 0) {
      found = true;
      earliestIndex = Math.min(earliestIndex, index);
    }
  }
  return found ? sequence[earliestIndex] ?? order.status : order.status;
}

function copyOrderItem(item: OrderItemDoc) {
  return {
    productId: item.productId ?? null,
    slug: item.slug,
    name: item.name,
    variantName: item.variantName,
    image: item.image,
    price: item.price,
    quantity: item.quantity,
    itemStatus: item.itemStatus,
  };
}

async function createUniquePublicCode() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = randomPublicCode();
    if (!(await Order.exists({ publicCode: code }))) return code;
  }
  throw ApiError.conflict("Không thể tạo mã đơn hàng duy nhất, vui lòng thử lại.");
}

/** Admin-only manual order entry for Facebook/in-store orders. */
ordersRouter.post(
  "/",
  attachUser,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = createManualOrderSchema.parse(req.body);
    const subtotal = body.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const total = body.total ?? subtotal;
    if (body.depositAmount > total) {
      throw ApiError.badRequest("Số tiền đặt cọc không được lớn hơn tổng tiền.");
    }

    const publicCode = await createUniquePublicCode();
    const status: OrderStatus = body.orderType === "pre_order" ? "deposit_received" : "packing";
    const paymentStatus = paymentStatusForAmounts(body.depositAmount, total);

    const order = await Order.create({
      publicCode,
      orderType: body.orderType,
      facebookName: body.facebookName,
      facebookUrl: body.facebookUrl,
      customerName: body.facebookName,
      customerEmail: "",
      phone: body.phone,
      provinceCode: "",
      provinceName: "",
      wardCode: "",
      wardName: "",
      addressDetail: body.addressDetail,
      shippingAddress: body.addressDetail,
      items: body.items.map((item) => ({ ...item, itemStatus: status })),
      subtotal,
      shippingFee: 0,
      tax: null,
      discount: 0,
      total,
      depositAmount: body.depositAmount,
      remainingAmount: total - body.depositAmount,
      status,
      statusMode: "auto",
      trackingCode: "",
      paymentMethod: "Chuyển khoản",
      paymentStatus,
      userId: req.user!.sub,
    });

    await FinanceTransaction.create({
      orderId: order.id,
      customer: order.facebookName,
      amount: order.total,
      type: "revenue",
      method: "Facebook",
      status: financeStatusFor(paymentStatus),
    });

    res.status(201).json({ order });
  }),
);

/** Public, read-only view used by the share link. Sensitive contact details are omitted. */
ordersRouter.get(
  "/public/:code",
  asyncHandler(async (req, res) => {
    const code = z.string().regex(/^[a-z0-9]{6}$/).parse(req.params.code.toLowerCase());
    const order = await Order.findOne({ publicCode: code });
    if (!order) throw ApiError.notFound("Không tìm thấy đơn hàng.");

    res.json({
      order: {
        publicCode: order.publicCode,
        orderType: order.orderType,
        facebookName: order.facebookName,
        items: order.items,
        subtotal: order.subtotal,
        total: order.total,
        depositAmount: order.depositAmount,
        remainingAmount: order.remainingAmount,
        status: order.status,
        trackingCode: order.trackingCode,
        placedAt: order.placedAt,
        updatedAt: order.updatedAt,
        sourceOrderCode: order.sourceOrderCode,
        splitOrderCodes: order.splitOrderCodes,
      },
    });
  }),
);

ordersRouter.use(attachUser);

ordersRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { status, q } = req.query as Record<string, string | string[] | undefined>;
    const pagination = getPagination(req);
    const statuses = Array.isArray(status) ? status : status ? [status] : [];
    const statusFilter = statuses.length === 0 ? {} : { status: { $in: statuses } };
    const searchText = typeof q === "string" ? q.trim() : "";
    const escapedSearch = searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const searchFilter = searchText ? { $or: [{ facebookName: { $regex: escapedSearch, $options: "i" } }, { customerName: { $regex: escapedSearch, $options: "i" } }] } : {};
    const filter = req.user!.role === "ADMIN" ? { ...statusFilter, ...searchFilter } : { ...statusFilter, ...searchFilter, userId: req.user!.sub };
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ placedAt: 1, _id: 1 }).skip(pagination.skip).limit(pagination.pageSize),
      Order.countDocuments(filter),
    ]);
    res.json(paginatedResponse(orders.map(normalizeLegacyPaymentStatus), total, pagination));
  }),
);

ordersRouter.get(
  "/summary",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const [summary] = await Order.aggregate<{ totalAmount: number; depositAmount: number }>([
      { $match: { status: { $ne: "shipped" } } },
      { $group: { _id: null, totalAmount: { $sum: "$total" }, depositAmount: { $sum: "$depositAmount" } } },
      { $project: { _id: 0, totalAmount: 1, depositAmount: 1 } },
    ]);
    const totalAmount = summary?.totalAmount ?? 0;
    const depositAmount = summary?.depositAmount ?? 0;
    res.json({ totalAmount, depositAmount, remainingAmount: Math.max(0, totalAmount - depositAmount) });
  }),
);

ordersRouter.get(
  "/ordered-products-summary",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const items = await Order.aggregate<{
      productId: string | null;
      slug: string;
      name: string;
      variantName: string;
      image: string;
      quantity: number;
      orderCount: number;
    }>([
      { $match: { orderType: "pre_order", status: { $nin: ["shipped", "cancelled"] } } },
      { $unwind: "$items" },
      { $match: { "items.itemStatus": { $nin: ["shipped"] } } },
      {
        $group: {
          _id: {
            productKey: { $ifNull: ["$items.productId", "$items.slug"] },
            variantName: { $ifNull: ["$items.variantName", ""] },
          },
          productId: { $first: "$items.productId" },
          slug: { $first: "$items.slug" },
          name: { $first: "$items.name" },
          variantName: { $first: { $ifNull: ["$items.variantName", ""] } },
          image: { $first: "$items.image" },
          quantity: { $sum: "$items.quantity" },
          orderCodes: { $addToSet: "$publicCode" },
        },
      },
      {
        $project: {
          _id: 0,
          productId: { $toString: "$productId" },
          slug: 1,
          name: 1,
          variantName: 1,
          image: 1,
          quantity: 1,
          orderCount: { $size: "$orderCodes" },
        },
      },
      { $sort: { name: 1, variantName: 1 } },
    ]);
    const savedQuantities = items.length > 0
      ? await FactoryOrderQuantity.find({
          $or: items.map((item) => ({ productKey: item.productId || item.slug, variantName: item.variantName })),
        }).lean()
      : [];
    const quantityMap = new Map(savedQuantities.map((item) => [`${item.productKey}\u0000${item.variantName}`, item.orderedQuantity]));
    const enrichedItems = items.map((item) => {
      const factoryOrderedQuantity = quantityMap.get(`${item.productId || item.slug}\u0000${item.variantName}`) ?? 0;
      return { ...item, factoryOrderedQuantity, surplusQuantity: factoryOrderedQuantity - item.quantity };
    });
    res.json({
      items: enrichedItems,
      totalQuantity: enrichedItems.reduce((sum, item) => sum + item.quantity, 0),
      totalFactoryOrderedQuantity: enrichedItems.reduce((sum, item) => sum + item.factoryOrderedQuantity, 0),
    });
  }),
);

ordersRouter.put(
  "/ordered-products-summary/factory-quantity",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = z.object({
      productKey: z.string().trim().min(1),
      variantName: z.string().trim().default(""),
      orderedQuantity: z.number().int().nonnegative(),
    }).parse(req.body);
    const quantity = await FactoryOrderQuantity.findOneAndUpdate(
      { productKey: body.productKey, variantName: body.variantName },
      { $set: { orderedQuantity: body.orderedQuantity } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    res.json({ quantity });
  }),
);

ordersRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id);
    if (!order) throw ApiError.notFound("Không tìm thấy đơn hàng.");
    const isOwner = order.userId && String(order.userId) === req.user!.sub;
    if (!isOwner && req.user!.role !== "ADMIN") throw ApiError.forbidden("Bạn không có quyền xem đơn hàng này.");
    res.json({ order: normalizeLegacyPaymentStatus(order) });
  }),
);

ordersRouter.patch(
  "/:id/items/:itemIndex/status",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { status } = itemStatusSchema.parse(req.body);
    const itemIndex = z.coerce.number().int().nonnegative().parse(req.params.itemIndex);
    const order = await Order.findById(req.params.id);
    if (!order) throw ApiError.notFound("Không tìm thấy đơn hàng.");
    const item = order.items[itemIndex];
    if (!item) throw ApiError.notFound("Không tìm thấy sản phẩm trong đơn hàng.");
    const type = order.orderType ?? "in_stock";
    if (!STATUS_BY_TYPE[type].includes(status)) throw ApiError.badRequest("Trạng thái không phù hợp với loại đơn hàng.");
    item.itemStatus = status;
    if ((order.statusMode ?? "auto") === "auto") order.status = earliestItemStatus(order);
    order.markModified("items");
    await order.save();
    res.json({ order });
  }),
);

ordersRouter.put(
  "/:id/items",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { items } = z.object({ items: z.array(orderItemSchema).min(1).max(100) }).parse(req.body);
    const order = await Order.findById(req.params.id);
    if (!order) throw ApiError.notFound("Không tìm thấy đơn hàng.");
    const allowedStatuses = STATUS_BY_TYPE[order.orderType ?? "in_stock"];
    for (const item of items) {
      if (item.itemStatus && !allowedStatuses.includes(item.itemStatus)) {
        throw ApiError.badRequest(`Trạng thái của sản phẩm ${item.name} không phù hợp với loại đơn.`);
      }
    }
    order.items = items.map((item) => ({
      ...item,
      productId: item.productId ? new Types.ObjectId(item.productId) : null,
      itemStatus: item.itemStatus ?? order.status,
    }));
    order.subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    if ((order.statusMode ?? "auto") === "auto") order.status = earliestItemStatus(order);
    await order.save();
    res.json({ order });
  }),
);

ordersRouter.post(
  "/:id/split",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = splitOrderSchema.parse(req.body);
    const order = await Order.findById(req.params.id);
    if (!order) throw ApiError.notFound("Không tìm thấy đơn hàng.");
    if (order.orderType !== "pre_order") throw ApiError.badRequest("Chỉ có thể tách sản phẩm từ đơn order.");
    if (body.newDepositAmount > body.newTotal || body.originalDepositAmount > body.originalTotal) {
      throw ApiError.badRequest("Tiền đặt cọc không được lớn hơn tổng tiền của từng đơn.");
    }

    const selectionMap = new Map<number, number>();
    for (const selection of body.selections) {
      if (selectionMap.has(selection.itemIndex)) throw ApiError.badRequest("Sản phẩm tách bị trùng lặp.");
      const item = order.items[selection.itemIndex];
      if (!item) throw ApiError.badRequest("Có sản phẩm không còn tồn tại trong đơn.");
      if ((item.itemStatus ?? order.status) !== "shop_warehouse") {
        throw ApiError.badRequest(`Sản phẩm ${item.name} chưa về kho shop.`);
      }
      if (selection.quantity > item.quantity) throw ApiError.badRequest(`Số lượng tách của ${item.name} không hợp lệ.`);
      selectionMap.set(selection.itemIndex, selection.quantity);
    }

    const remainingItems = order.items.flatMap((item, index) => {
      const selectedQuantity = selectionMap.get(index) ?? 0;
      if (selectedQuantity === item.quantity) return [];
      return [{ ...copyOrderItem(item), quantity: item.quantity - selectedQuantity }];
    });
    if (remainingItems.length === 0) throw ApiError.badRequest("Không thể tách toàn bộ sản phẩm. Hãy đổi loại đơn hiện tại sang hàng có sẵn.");

    const splitItems = body.selections.map(({ itemIndex, quantity }) => {
      const item = order.items[itemIndex];
      return { ...copyOrderItem(item), quantity, itemStatus: "packing" as OrderStatus };
    });
    const newSubtotal = splitItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const originalSubtotal = remainingItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const publicCode = await createUniquePublicCode();
    const newPaymentStatus = paymentStatusForAmounts(body.newDepositAmount, body.newTotal);
    const originalPaymentStatus = paymentStatusForAmounts(body.originalDepositAmount, body.originalTotal);

    const newOrder = await Order.create({
      publicCode,
      orderType: "in_stock",
      facebookName: order.facebookName,
      facebookUrl: order.facebookUrl,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      phone: order.phone,
      provinceCode: order.provinceCode,
      provinceName: order.provinceName,
      wardCode: order.wardCode,
      wardName: order.wardName,
      addressDetail: order.addressDetail,
      shippingAddress: order.shippingAddress,
      items: splitItems,
      subtotal: newSubtotal,
      shippingFee: 0,
      tax: null,
      discount: 0,
      total: body.newTotal,
      depositAmount: body.newDepositAmount,
      remainingAmount: body.newTotal - body.newDepositAmount,
      status: "packing",
      statusMode: "auto",
      trackingCode: "",
      paymentMethod: order.paymentMethod,
      paymentStatus: newPaymentStatus,
      userId: order.userId,
      sourceOrderCode: order.publicCode,
    });

    order.items = remainingItems;
    order.subtotal = originalSubtotal;
    order.total = body.originalTotal;
    order.depositAmount = body.originalDepositAmount;
    order.remainingAmount = body.originalTotal - body.originalDepositAmount;
    order.paymentStatus = originalPaymentStatus;
    order.splitOrderCodes = [...(order.splitOrderCodes ?? []), publicCode];
    if ((order.statusMode ?? "auto") === "auto") order.status = earliestItemStatus(order);
    await order.save();

    await Promise.all([
      FinanceTransaction.findOneAndUpdate(
        { orderId: order.id },
        { amount: order.total, status: financeStatusFor(originalPaymentStatus) },
      ),
      FinanceTransaction.create({
        orderId: newOrder.id,
        customer: newOrder.facebookName,
        amount: newOrder.total,
        type: "revenue",
        method: "Facebook",
        status: financeStatusFor(newPaymentStatus),
      }),
    ]);

    res.status(201).json({ originalOrder: order, newOrder });
  }),
);

ordersRouter.patch(
  "/:id/status",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = statusSchema.parse(req.body);
    const order = await Order.findById(req.params.id);
    if (!order) throw ApiError.notFound("Không tìm thấy đơn hàng.");

    const type = order.orderType ?? "in_stock";
    if (!STATUS_BY_TYPE[type].includes(body.status)) {
      throw ApiError.badRequest("Trạng thái không phù hợp với loại đơn hàng.");
    }
    order.status = body.status;
    order.statusMode = "manual";
    if (body.status === "shipped") order.trackingCode = body.trackingCode ?? order.trackingCode;
    await order.save();
    res.json({ order });
  }),
);

ordersRouter.patch(
  "/:id/status/automatic",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id);
    if (!order) throw ApiError.notFound("Không tìm thấy đơn hàng.");
    order.statusMode = "auto";
    order.status = earliestItemStatus(order);
    if (order.status !== "shipped") order.trackingCode = "";
    await order.save();
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
    await FinanceTransaction.findOneAndUpdate({ orderId: order.id }, { status: financeStatusFor(paymentStatus) });
    res.json({ order });
  }),
);

ordersRouter.patch(
  "/:id/details",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = detailsSchema.parse(req.body);
    const order = await Order.findById(req.params.id);
    if (!order) throw ApiError.notFound("Không tìm thấy đơn hàng.");

    const total = body.total ?? order.total;
    const depositAmount = body.depositAmount ?? order.depositAmount ?? 0;
    if (depositAmount > total) throw ApiError.badRequest("Số tiền đặt cọc không được lớn hơn tổng tiền.");

    if (body.facebookName !== undefined) {
      order.facebookName = body.facebookName;
      order.customerName = body.facebookName;
    }
    if (body.orderType !== undefined && body.orderType !== order.orderType) {
      order.orderType = body.orderType;
      order.status = body.orderType === "pre_order" ? "deposit_received" : "packing";
      order.statusMode = "auto";
      order.items.forEach((item) => { item.itemStatus = order.status; });
      order.markModified("items");
      order.trackingCode = "";
    }
    if (body.facebookUrl !== undefined) order.facebookUrl = body.facebookUrl;
    if (body.phone !== undefined) order.phone = body.phone;
    if (body.addressDetail !== undefined) {
      order.addressDetail = body.addressDetail;
      order.shippingAddress = body.addressDetail;
    }
    order.total = total;
    order.depositAmount = depositAmount;
    order.remainingAmount = total - depositAmount;
    order.paymentStatus = paymentStatusForAmounts(depositAmount, total);
    await order.save();

    await FinanceTransaction.findOneAndUpdate(
      { orderId: order.id },
      { amount: order.total, customer: order.facebookName, status: financeStatusFor(order.paymentStatus) },
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
    await Promise.all([
      FinanceTransaction.deleteOne({ orderId: existing.id }),
      Order.updateMany({ splitOrderCodes: existing.publicCode }, { $pull: { splitOrderCodes: existing.publicCode } }),
    ]);
    res.status(204).end();
  }),
);

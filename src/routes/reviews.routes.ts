import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { attachUser, requireAdmin, requireAuth } from "../middleware/auth";
import { requireDb } from "../middleware/require-db";
import { Order } from "../models/order.model";
import { Product } from "../models/product.model";
import { Review } from "../models/review.model";
import { User } from "../models/user.model";
import { ApiError } from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";
import { getPagination, paginatedResponse } from "../utils/pagination";

export const reviewsRouter = Router();
reviewsRouter.use(requireDb);

const createReviewSchema = z.object({
  productId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(1),
});

/** Recomputes Product.rating/reviewCount from real Review documents after a create/delete. */
async function recomputeProductRating(productId: string) {
  const [agg] = await Review.aggregate<{ avgRating: number; count: number }>([
    { $match: { productId: new Types.ObjectId(productId) } },
    { $group: { _id: null, avgRating: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  await Product.findByIdAndUpdate(productId, {
    rating: agg ? Math.round(agg.avgRating * 10) / 10 : 0,
    reviewCount: agg?.count ?? 0,
  });
}

/** Public — the product detail page reads reviews without needing a session. */
reviewsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { productId } = req.query as Record<string, string | undefined>;
    if (!productId) throw ApiError.badRequest("Thiếu productId.");
    const pagination = getPagination(req);

    const [reviews, total] = await Promise.all([
      Review.find({ productId }).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.pageSize),
      Review.countDocuments({ productId }),
    ]);

    res.json(paginatedResponse(reviews, total, pagination));
  }),
);

/**
 * Shopee-style rule: only a signed-in customer who actually has a (non-cancelled) order
 * containing this product may review it, and only once per product.
 */
reviewsRouter.post(
  "/",
  attachUser,
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = createReviewSchema.parse(req.body);

    const product = await Product.findById(body.productId);
    if (!product) throw ApiError.notFound("Không tìm thấy sản phẩm.");

    const hasPurchased = await Order.exists({
      userId: req.user!.sub,
      "items.productId": body.productId,
      status: { $ne: "cancelled" },
    });
    if (!hasPurchased) throw ApiError.forbidden("Bạn cần mua sản phẩm này để có thể đánh giá.");

    const user = await User.findById(req.user!.sub);
    if (!user) throw ApiError.unauthorized("Không tìm thấy tài khoản.");

    const review = await Review.create({
      productId: body.productId,
      userId: req.user!.sub,
      customerName: user.name,
      rating: body.rating,
      comment: body.comment,
    });

    await recomputeProductRating(body.productId);

    res.status(201).json({ review });
  }),
);

reviewsRouter.delete(
  "/:id",
  attachUser,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const existing = await Review.findByIdAndDelete(req.params.id);
    if (!existing) throw ApiError.notFound("Không tìm thấy đánh giá.");
    await recomputeProductRating(String(existing.productId));
    res.status(204).end();
  }),
);

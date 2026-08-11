import { Router } from "express";
import { Types } from "mongoose";
import { attachUser, requireAuth } from "../middleware/auth";
import { requireDb } from "../middleware/require-db";
import { Product } from "../models/product.model";
import { User } from "../models/user.model";
import { ApiError } from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";

export const favoritesRouter = Router();

favoritesRouter.use(requireDb, attachUser, requireAuth);

favoritesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.sub).select("favoriteProductIds");
    if (!user) throw ApiError.unauthorized();

    res.json({ favoriteIds: user.favoriteProductIds.map(String) });
  }),
);

favoritesRouter.put(
  "/:productId",
  asyncHandler(async (req, res) => {
    const { productId } = req.params;
    if (!Types.ObjectId.isValid(productId)) throw ApiError.badRequest("Mã sản phẩm không hợp lệ.");

    const [user, product] = await Promise.all([
      User.findById(req.user!.sub),
      Product.findById(productId).select("favoriteCount"),
    ]);
    if (!user) throw ApiError.unauthorized();
    if (!product) throw ApiError.notFound("Không tìm thấy sản phẩm.");

    const active = user.favoriteProductIds.some((id) => id.equals(productId));
    if (active) {
      user.favoriteProductIds = user.favoriteProductIds.filter((id) => !id.equals(productId));
      product.favoriteCount = Math.max(0, (product.favoriteCount ?? 0) - 1);
    } else {
      user.favoriteProductIds.push(new Types.ObjectId(productId));
      product.favoriteCount = (product.favoriteCount ?? 0) + 1;
    }

    await Promise.all([user.save(), product.save()]);

    res.json({
      active: !active,
      favoriteIds: user.favoriteProductIds.map(String),
      favoriteCount: product.favoriteCount,
    });
  }),
);

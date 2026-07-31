import { Router } from "express";
import { z } from "zod";
import { attachUser, requireAdmin } from "../middleware/auth";
import { requireDb } from "../middleware/require-db";
import { Promotion } from "../models/promotion.model";
import { ApiError } from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";
import { getPagination, paginatedResponse } from "../utils/pagination";

export const promotionsRouter = Router();
promotionsRouter.use(requireDb);

const promotionSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  type: z.enum(["percentage", "fixed", "bundle"]),
  value: z.number().int().nonnegative(),
  appliesTo: z.string().default(""),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  status: z.enum(["active", "scheduled", "expired"]).default("scheduled"),
  usageLimit: z.number().int().nonnegative().default(0),
});

/** Public — checkout needs to validate a promo code without admin rights. */
promotionsRouter.get(
  "/code/:code",
  asyncHandler(async (req, res) => {
    const promotion = await Promotion.findOne({ code: req.params.code.toUpperCase() });
    if (!promotion) throw ApiError.notFound("Mã khuyến mãi không tồn tại.");

    const now = new Date();
    const isValid =
      promotion.status === "active" &&
      now >= promotion.startDate &&
      now <= promotion.endDate &&
      (promotion.usageLimit === 0 || promotion.usageCount < promotion.usageLimit);

    res.json({ promotion, isValid });
  }),
);

promotionsRouter.use(attachUser, requireAdmin);

promotionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status } = req.query as Record<string, string | undefined>;
    const pagination = getPagination(req);
    const filter = status ? { status } : {};

    const [promotions, total] = await Promise.all([
      Promotion.find(filter).sort({ startDate: -1 }).skip(pagination.skip).limit(pagination.pageSize),
      Promotion.countDocuments(filter),
    ]);

    res.json(paginatedResponse(promotions, total, pagination));
  }),
);

promotionsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const promotion = await Promotion.findById(req.params.id);
    if (!promotion) throw ApiError.notFound("Không tìm thấy khuyến mãi.");
    res.json({ promotion });
  }),
);

promotionsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = promotionSchema.parse(req.body);
    const code = body.code.toUpperCase();

    const existing = await Promotion.findOne({ code });
    if (existing) throw ApiError.conflict(`Mã "${code}" đã tồn tại.`);

    const promotion = await Promotion.create({ ...body, code });
    res.status(201).json({ promotion });
  }),
);

promotionsRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = promotionSchema.partial().parse(req.body);

    const existing = await Promotion.findById(id);
    if (!existing) throw ApiError.notFound("Không tìm thấy khuyến mãi.");

    const code = body.code?.toUpperCase();
    if (code && code !== existing.code) {
      const clash = await Promotion.findOne({ code });
      if (clash) throw ApiError.conflict(`Mã "${code}" đã tồn tại.`);
    }

    Object.assign(existing, { ...body, code: code ?? existing.code });
    await existing.save();
    res.json({ promotion: existing });
  }),
);

promotionsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await Promotion.findByIdAndDelete(req.params.id);
    if (!existing) throw ApiError.notFound("Không tìm thấy khuyến mãi.");
    res.status(204).end();
  }),
);

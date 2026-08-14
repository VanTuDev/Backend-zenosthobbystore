import { Router } from "express";
import type { HydratedDocument } from "mongoose";
import { z } from "zod";
import { attachUser, requireAdmin } from "../middleware/auth";
import { requireDb } from "../middleware/require-db";
import { Category, type CategoryDoc } from "../models/category.model";
import { Product } from "../models/product.model";
import { ApiError } from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";
import { slugify } from "../utils/slugify";

export const categoriesRouter = Router();
categoriesRouter.use(requireDb);

const categorySchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  status: z.enum(["active", "hidden"]).default("active"),
  description: z.string().default(""),
  image: z.string().default(""),
  parentId: z.string().nullable().optional(),
  folderIds: z.array(z.string()).default([]),
});

async function withProductCount(categories: HydratedDocument<CategoryDoc>[]) {
  const counts = await Product.aggregate<{ _id: unknown; count: number }>([
    { $match: { categoryId: { $in: categories.map((c) => c._id) } } },
    { $group: { _id: "$categoryId", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.count]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const totals = new Map(categories.map((category) => [category.id, countMap.get(category.id) ?? 0]));

  for (const category of categories) {
    const directCount = countMap.get(category.id) ?? 0;
    let parentId = category.parentId ? String(category.parentId) : null;
    const visited = new Set<string>();
    while (parentId && categoryById.has(parentId) && !visited.has(parentId)) {
      visited.add(parentId);
      totals.set(parentId, (totals.get(parentId) ?? 0) + directCount);
      const parent = categoryById.get(parentId)!;
      parentId = parent.parentId ? String(parent.parentId) : null;
    }
  }

  return categories.map((category) => ({ ...category.toJSON(), productCount: totals.get(category.id) ?? 0 }));
}

categoriesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const categories = await Category.find().sort({ name: 1 });
    res.json({ categories: await withProductCount(categories) });
  }),
);

categoriesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const category = await Category.findById(req.params.id);
    if (!category) throw ApiError.notFound("Không tìm thấy danh mục.");
    const [withCount] = await withProductCount([category]);
    res.json({ category: withCount });
  }),
);

categoriesRouter.post(
  "/",
  attachUser,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = categorySchema.parse(req.body);
    const slug = body.slug?.trim() || slugify(body.name);

    const existing = await Category.findOne({ slug });
    if (existing) throw ApiError.conflict(`Slug "${slug}" đã tồn tại.`);

    const category = await Category.create({ ...body, slug, parentId: body.parentId ?? null });
    res.status(201).json({ category: { ...category.toJSON(), productCount: 0 } });
  }),
);

categoriesRouter.put(
  "/:id",
  attachUser,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = categorySchema.partial().parse(req.body);

    const existing = await Category.findById(id);
    if (!existing) throw ApiError.notFound("Không tìm thấy danh mục.");

    if (id === body.parentId) throw ApiError.badRequest("Danh mục không thể là cha của chính nó.");

    if (body.slug && body.slug !== existing.slug) {
      const clash = await Category.findOne({ slug: body.slug });
      if (clash) throw ApiError.conflict(`Slug "${body.slug}" đã tồn tại.`);
    }

    Object.assign(existing, body);
    await existing.save();

    const [withCount] = await withProductCount([existing]);
    res.json({ category: withCount });
  }),
);

categoriesRouter.delete(
  "/:id",
  attachUser,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await Category.findById(id);
    if (!existing) throw ApiError.notFound("Không tìm thấy danh mục.");

    const childCount = await Category.countDocuments({ parentId: id });
    if (childCount > 0) throw ApiError.conflict("Không thể xóa danh mục còn danh mục con.");

    const productCount = await Product.countDocuments({ categoryId: id });
    if (productCount > 0) throw ApiError.conflict("Không thể xóa danh mục còn sản phẩm bên trong.");

    await existing.deleteOne();
    res.status(204).end();
  }),
);

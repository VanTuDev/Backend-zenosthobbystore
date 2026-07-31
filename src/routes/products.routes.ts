import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { attachUser, requireAdmin } from "../middleware/auth";
import { requireDb } from "../middleware/require-db";
import { Product } from "../models/product.model";
import { ApiError } from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";
import { getPagination, paginatedResponse } from "../utils/pagination";
import { toArray } from "../utils/query";
import { slugify } from "../utils/slugify";

export const productsRouter = Router();
productsRouter.use(requireDb);

/**
 * Keys the storefront's "Sắp xếp theo" select can request; default is newest-first.
 * `_id` is always the final tiebreaker — without one, rows that tie on the primary
 * key (e.g. many products seeded within the same millisecond) can be reordered
 * between two separate skip/limit page fetches, which duplicates or drops rows
 * across the infinite-scroll pages the storefront renders.
 */
const SORT_OPTIONS: Record<string, Record<string, 1 | -1>> = {
  "moi-nhap": { createdAt: -1, _id: -1 },
  "gia-thap-cao": { price: 1, _id: -1 },
  "gia-cao-thap": { price: -1, _id: -1 },
  "pho-bien": { reviewCount: -1, _id: -1 },
};

const specSchema = z.object({ label: z.string(), value: z.string() });

const productSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  brand: z.string().default(""),
  universe: z.string().default(""),
  scale: z.string().default(""),
  price: z.number().int().nonnegative(),
  compareAtPrice: z.number().int().nonnegative().nullable().optional(),
  sellingPrice: z.number().int().nonnegative().nullable().optional(),
  originalPrice: z.number().int().nonnegative().nullable().optional(),
  promoPrice: z.number().int().nonnegative().nullable().optional(),
  costPrice: z.number().int().nonnegative().nullable().optional(),
  stockStatus: z.enum(["in_stock", "pre_order", "sold_out", "coming_soon"]).default("in_stock"),
  stockCount: z.number().int().nonnegative().default(0),
  badges: z.array(z.string()).default([]),
  rating: z.number().min(0).max(5).default(0),
  reviewCount: z.number().int().nonnegative().default(0),
  description: z.string().default(""),
  highlights: z.array(z.string()).default([]),
  specs: z.array(specSchema).default([]),
  images: z.array(z.string()).default([]),
  heroImage: z.string().default(""),
  categoryId: z.string().nullable().optional(),
});

productsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q, stockStatus, scale, sort } = req.query as Record<string, string | undefined>;
    const categoryIds = toArray(req.query.categoryId);
    const brands = toArray(req.query.brand);
    const badges = toArray(req.query.badge);
    const minPrice = req.query.minPrice !== undefined ? Number(req.query.minPrice) : undefined;
    const maxPrice = req.query.maxPrice !== undefined ? Number(req.query.maxPrice) : undefined;
    const pagination = getPagination(req);

    const priceFilter: Record<string, number> = {};
    if (minPrice !== undefined && !Number.isNaN(minPrice)) priceFilter.$gte = minPrice;
    if (maxPrice !== undefined && !Number.isNaN(maxPrice)) priceFilter.$lte = maxPrice;

    const filter: Record<string, unknown> = {
      ...(categoryIds.length ? { categoryId: { $in: categoryIds } } : {}),
      ...(stockStatus ? { stockStatus } : {}),
      ...(brands.length ? { brand: { $in: brands } } : {}),
      ...(badges.length ? { badges: { $in: badges } } : {}),
      ...(scale ? { scale } : {}),
      ...(Object.keys(priceFilter).length ? { price: priceFilter } : {}),
      ...(q ? { $text: { $search: q } } : {}),
    };

    const sortSpec = SORT_OPTIONS[sort ?? ""] ?? SORT_OPTIONS["moi-nhap"];

    const [products, total] = await Promise.all([
      Product.find(filter).sort(sortSpec).skip(pagination.skip).limit(pagination.pageSize),
      Product.countDocuments(filter),
    ]);

    res.json(paginatedResponse(products, total, pagination));
  }),
);

/**
 * Facet counts (distinct brands/scales in the catalog) for the storefront
 * filter sidebar. Must be registered before `/:idOrSlug` or Express would
 * treat "facets" as a product id/slug lookup.
 */
productsRouter.get(
  "/facets",
  asyncHandler(async (_req, res) => {
    const [brandRows, scaleRows] = await Promise.all([
      Product.aggregate<{ _id: string; count: number }>([
        { $match: { brand: { $ne: "" } } },
        { $group: { _id: "$brand", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Product.aggregate<{ _id: string; count: number }>([
        { $match: { scale: { $ne: "" } } },
        { $group: { _id: "$scale", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    res.json({
      brands: brandRows.map((r) => ({ value: r._id, count: r.count })),
      scales: scaleRows.map((r) => ({ value: r._id, count: r.count })),
    });
  }),
);

productsRouter.get(
  "/:idOrSlug",
  asyncHandler(async (req, res) => {
    const { idOrSlug } = req.params;
    const conditions: Record<string, unknown>[] = [{ slug: idOrSlug }];
    if (Types.ObjectId.isValid(idOrSlug)) conditions.push({ _id: idOrSlug });

    const product = await Product.findOne({ $or: conditions });
    if (!product) throw ApiError.notFound("Không tìm thấy sản phẩm.");
    res.json({ product });
  }),
);

productsRouter.post(
  "/",
  attachUser,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = productSchema.parse(req.body);
    const slug = body.slug?.trim() || slugify(body.name);

    const existing = await Product.findOne({ slug });
    if (existing) throw ApiError.conflict(`Slug "${slug}" đã tồn tại.`);

    const product = await Product.create({
      ...body,
      slug,
      heroImage: body.heroImage || body.images[0] || "",
    });

    res.status(201).json({ product });
  }),
);

productsRouter.put(
  "/:id",
  attachUser,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = productSchema.partial().parse(req.body);

    const existing = await Product.findById(id);
    if (!existing) throw ApiError.notFound("Không tìm thấy sản phẩm.");

    if (body.slug && body.slug !== existing.slug) {
      const clash = await Product.findOne({ slug: body.slug });
      if (clash) throw ApiError.conflict(`Slug "${body.slug}" đã tồn tại.`);
    }

    Object.assign(existing, body);
    await existing.save();

    res.json({ product: existing });
  }),
);

productsRouter.delete(
  "/:id",
  attachUser,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const existing = await Product.findByIdAndDelete(req.params.id);
    if (!existing) throw ApiError.notFound("Không tìm thấy sản phẩm.");
    res.status(204).end();
  }),
);

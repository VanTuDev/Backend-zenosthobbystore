import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { attachUser, requireAdmin } from "../middleware/auth";
import { requireDb } from "../middleware/require-db";
import { Product } from "../models/product.model";
import { Category } from "../models/category.model";
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
  "pho-bien": { favoriteCount: -1, _id: -1 },
};

const specSchema = z.object({ label: z.string(), value: z.string() });

const productVideoSchema = z.object({
  url: z.string().url(),
  thumbnail: z.string().default(""),
  provider: z.enum(["tiktok", "youtube"]),
});

const productVariantSchema = z.object({
  name: z.string().min(1),
  price: z.number().int().positive("Giá biến thể phải lớn hơn 0."),
  stockCount: z.number().int().nonnegative().default(0),
  image: z.string().default(""),
});

const productSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  brand: z.string().default(""),
  universe: z.string().default(""),
  scale: z.string().default(""),
  productType: z.enum(["in_stock", "pre_order"]).default("in_stock"),
  price: z.number().int().nonnegative().optional(),
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
  favoriteCount: z.number().int().nonnegative().optional(),
  description: z.string().default(""),
  highlights: z.array(z.string()).default([]),
  specs: z.array(specSchema).default([]),
  images: z.array(z.string()).default([]),
  heroImage: z.string().default(""),
  videos: z.array(productVideoSchema).default([]),
  variants: z
    .array(productVariantSchema)
    .min(1, "Mỗi sản phẩm phải có ít nhất 1 biến thể.")
    .max(100, "Tối đa 100 biến thể mỗi sản phẩm."),
  categoryId: z.string().nullable().optional(),
});

function deriveProductSummary(variants: z.infer<typeof productVariantSchema>[]) {
  const price = Math.min(...variants.map((variant) => variant.price ?? 0));
  const stockCount = variants.reduce((total, variant) => total + (variant.stockCount ?? 0), 0);

  return {
    price,
    sellingPrice: price,
    compareAtPrice: null,
    originalPrice: null,
    promoPrice: null,
    costPrice: null,
    stockCount,
    stockStatus: variants.some((variant) => (variant.stockCount ?? 0) > 0)
      ? ("in_stock" as const)
      : ("sold_out" as const),
  };
}

const resolveVideoSchema = z.object({ url: z.string().url() });

function detectVideoProvider(url: string): "tiktok" | "youtube" | null {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").replace(/^m\./, "");
  } catch {
    return null;
  }
  if (host.endsWith("tiktok.com")) return "tiktok";
  if (host === "youtube.com" || host === "youtu.be") return "youtube";
  return null;
}

const OEMBED_URL: Record<"tiktok" | "youtube", (url: string) => string> = {
  tiktok: (url) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
  youtube: (url) => `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
};

async function includeDescendantCategoryIds(selectedIds: string[]) {
  if (selectedIds.length === 0) return selectedIds;
  const categories = await Category.find().select("_id parentId").lean();
  const expanded = new Set(selectedIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (!category.parentId || !expanded.has(String(category.parentId))) continue;
      const id = String(category._id);
      if (!expanded.has(id)) {
        expanded.add(id);
        changed = true;
      }
    }
  }
  return [...expanded];
}

productsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q, stockStatus, productType, scale, sort } = req.query as Record<string, string | undefined>;
    const categoryIds = toArray(req.query.categoryId);
    const expandedCategoryIds = await includeDescendantCategoryIds(categoryIds);
    const brands = toArray(req.query.brand);
    const badges = toArray(req.query.badge);
    const minPrice = req.query.minPrice !== undefined ? Number(req.query.minPrice) : undefined;
    const maxPrice = req.query.maxPrice !== undefined ? Number(req.query.maxPrice) : undefined;
    const pagination = getPagination(req);
    const searchText = q?.trim() ?? "";
    const escapedSearch = searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const priceFilter: Record<string, number> = {};
    if (minPrice !== undefined && !Number.isNaN(minPrice)) priceFilter.$gte = minPrice;
    if (maxPrice !== undefined && !Number.isNaN(maxPrice)) priceFilter.$lte = maxPrice;

    const requestedProductType = productType ?? (stockStatus === "pre_order" ? "pre_order" : undefined);
    const normalizedStockStatus = stockStatus === "pre_order" ? undefined : stockStatus;
    const typeAndStockFilter: Record<string, unknown> = requestedProductType === "pre_order"
      ? { $or: [{ productType: "pre_order" }, { productType: { $exists: false }, stockStatus: "pre_order" }] }
      : requestedProductType === "in_stock"
        ? { $and: [{ productType: { $ne: "pre_order" } }, { stockStatus: { $ne: "pre_order" } }] }
        : {};
    const compoundFilters: Record<string, unknown>[] = [];
    if (Object.keys(typeAndStockFilter).length > 0) compoundFilters.push(typeAndStockFilter);
    if (searchText) {
      compoundFilters.push({
        $or: [
          { name: { $regex: escapedSearch, $options: "i" } },
          { brand: { $regex: escapedSearch, $options: "i" } },
          { universe: { $regex: escapedSearch, $options: "i" } },
        ],
      });
    }
    const filter: Record<string, unknown> = {
      ...(expandedCategoryIds.length ? { categoryId: { $in: expandedCategoryIds } } : {}),
      ...(compoundFilters.length ? { $and: compoundFilters } : {}),
      ...(normalizedStockStatus ? { stockStatus: normalizedStockStatus } : {}),
      ...(brands.length ? { brand: { $in: brands } } : {}),
      ...(badges.length ? { badges: { $in: badges } } : {}),
      ...(scale ? { scale } : {}),
      ...(Object.keys(priceFilter).length ? { price: priceFilter } : {}),
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

/**
 * Admin pastes a TikTok/YouTube link when adding a gallery video; this resolves the provider's
 * oEmbed cover image server-side (avoids CORS/API-key issues doing it from the browser) so the
 * admin sees the real thumbnail immediately instead of a blank tile.
 */
productsRouter.post(
  "/resolve-video",
  attachUser,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { url } = resolveVideoSchema.parse(req.body);
    const provider = detectVideoProvider(url);
    if (!provider) throw ApiError.badRequest("Chỉ hỗ trợ link TikTok hoặc YouTube.");

    let thumbnail = "";
    try {
      const oembedRes = await fetch(OEMBED_URL[provider](url));
      if (!oembedRes.ok) throw new Error(`oEmbed responded ${oembedRes.status}`);
      const data = (await oembedRes.json()) as { thumbnail_url?: string };
      thumbnail = data.thumbnail_url ?? "";
    } catch {
      throw ApiError.badRequest("Không lấy được thông tin từ link này — kiểm tra lại đường dẫn.");
    }

    res.json({ provider, thumbnail });
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
      ...deriveProductSummary(body.variants),
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

    Object.assign(existing, body, body.variants ? deriveProductSummary(body.variants) : {});
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

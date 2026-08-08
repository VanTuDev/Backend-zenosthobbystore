import { Schema, model, Types } from "mongoose";
import { applyJsonTransform } from "./plugin";

export type StockStatus = "in_stock" | "pre_order" | "sold_out" | "coming_soon";

export interface ProductSpec {
  label: string;
  value: string;
}

export type ProductVideoProvider = "tiktok" | "youtube";

export interface ProductVideo {
  url: string;
  /** Fetched via the provider's oEmbed API when the admin adds the link — see POST /products/resolve-video. */
  thumbnail: string;
  provider: ProductVideoProvider;
}

export interface ProductDoc {
  name: string;
  slug: string;
  brand: string;
  universe: string;
  scale: string;
  price: number;
  compareAtPrice?: number | null;
  sellingPrice?: number | null;
  originalPrice?: number | null;
  promoPrice?: number | null;
  costPrice?: number | null;
  stockStatus: StockStatus;
  stockCount: number;
  badges: string[];
  rating: number;
  reviewCount: number;
  description: string;
  highlights: string[];
  specs: ProductSpec[];
  images: string[]; // no upload pipeline yet — plain URL strings
  heroImage: string;
  /** TikTok/YouTube clips for the product gallery's video row — link-out only, never embedded/hosted. */
  videos: ProductVideo[];
  categoryId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const specSchema = new Schema<ProductSpec>({ label: String, value: String }, { _id: false });

const videoSchema = new Schema<ProductVideo>(
  {
    url: { type: String, required: true },
    thumbnail: { type: String, default: "" },
    provider: { type: String, enum: ["tiktok", "youtube"], required: true },
  },
  { _id: false },
);

const productSchema = new Schema<ProductDoc>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    brand: { type: String, default: "" },
    universe: { type: String, default: "" },
    scale: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    compareAtPrice: { type: Number, default: null },
    sellingPrice: { type: Number, default: null },
    originalPrice: { type: Number, default: null },
    promoPrice: { type: Number, default: null },
    costPrice: { type: Number, default: null },
    stockStatus: {
      type: String,
      enum: ["in_stock", "pre_order", "sold_out", "coming_soon"],
      default: "in_stock",
    },
    stockCount: { type: Number, default: 0, min: 0 },
    badges: { type: [String], default: [] },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0, min: 0 },
    description: { type: String, default: "" },
    highlights: { type: [String], default: [] },
    specs: { type: [specSchema], default: [] },
    images: { type: [String], default: [] },
    heroImage: { type: String, default: "" },
    videos: { type: [videoSchema], default: [] },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", default: null },
  },
  { timestamps: true },
);

productSchema.index({ name: "text", brand: "text", universe: "text" });

applyJsonTransform(productSchema);

export const Product = model<ProductDoc>("Product", productSchema);

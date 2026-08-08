import { Schema, model, Types } from "mongoose";
import { applyJsonTransform } from "./plugin";

export interface ReviewDoc {
  productId: Types.ObjectId;
  userId: Types.ObjectId;
  customerName: string;
  rating: number;
  comment: string;
  images: string[];
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<ReviewDoc>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    customerName: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true },
    images: { type: [String], default: [] },
  },
  { timestamps: true },
);

// One review per customer per product — a second attempt 409s via the global duplicate-key handler.
reviewSchema.index({ productId: 1, userId: 1 }, { unique: true });

applyJsonTransform(reviewSchema);

export const Review = model<ReviewDoc>("Review", reviewSchema);

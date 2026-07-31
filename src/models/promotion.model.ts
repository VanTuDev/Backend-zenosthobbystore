import { Schema, model } from "mongoose";
import { applyJsonTransform } from "./plugin";

export type PromotionType = "percentage" | "fixed" | "bundle";
export type PromotionStatus = "active" | "scheduled" | "expired";

export interface PromotionDoc {
  name: string;
  code: string;
  type: PromotionType;
  value: number;
  appliesTo: string;
  startDate: Date;
  endDate: Date;
  status: PromotionStatus;
  usageCount: number;
  usageLimit: number;
  createdAt: Date;
  updatedAt: Date;
}

const promotionSchema = new Schema<PromotionDoc>(
  {
    name: { type: String, required: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    type: { type: String, enum: ["percentage", "fixed", "bundle"], required: true },
    value: { type: Number, required: true, min: 0 },
    appliesTo: { type: String, default: "" },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: ["active", "scheduled", "expired"], default: "scheduled" },
    usageCount: { type: Number, default: 0, min: 0 },
    usageLimit: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

applyJsonTransform(promotionSchema);

export const Promotion = model<PromotionDoc>("Promotion", promotionSchema);

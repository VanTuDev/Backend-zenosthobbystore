import { Schema, model } from "mongoose";
import { applyJsonTransform } from "./plugin";

export interface FactoryOrderQuantityDoc {
  productKey: string;
  variantName: string;
  orderedQuantity: number;
  createdAt: Date;
  updatedAt: Date;
}

const factoryOrderQuantitySchema = new Schema<FactoryOrderQuantityDoc>({
  productKey: { type: String, required: true, trim: true },
  variantName: { type: String, default: "", trim: true },
  orderedQuantity: { type: Number, required: true, min: 0, default: 0 },
}, { timestamps: true });

factoryOrderQuantitySchema.index({ productKey: 1, variantName: 1 }, { unique: true });
applyJsonTransform(factoryOrderQuantitySchema);

export const FactoryOrderQuantity = model<FactoryOrderQuantityDoc>("FactoryOrderQuantity", factoryOrderQuantitySchema);

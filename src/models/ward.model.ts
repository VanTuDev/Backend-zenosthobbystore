import { Schema, model } from "mongoose";
import { applyJsonTransform } from "./plugin";

export interface WardDoc {
  /** Government administrative code — the real-world key, not Mongo's _id. */
  code: string;
  name: string;
  fullName: string;
  codeName: string;
  /** FK → Province.code (post-2025 reform: wards nest directly under provinces, no district level). */
  provinceCode: string;
}

const wardSchema = new Schema<WardDoc>({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  fullName: { type: String, required: true },
  codeName: { type: String, required: true },
  provinceCode: { type: String, required: true, index: true },
});

applyJsonTransform(wardSchema);

export const Ward = model<WardDoc>("Ward", wardSchema);

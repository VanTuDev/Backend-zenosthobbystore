import { Schema, model } from "mongoose";
import { applyJsonTransform } from "./plugin";

export interface ProvinceDoc {
  /** Government administrative code, e.g. "01" for Hà Nội — the real-world key, not Mongo's _id. */
  code: string;
  name: string;
  fullName: string;
  codeName: string;
}

const provinceSchema = new Schema<ProvinceDoc>({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  fullName: { type: String, required: true },
  codeName: { type: String, required: true },
});

applyJsonTransform(provinceSchema);

export const Province = model<ProvinceDoc>("Province", provinceSchema);

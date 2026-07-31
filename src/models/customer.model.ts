import { Schema, model } from "mongoose";
import { applyJsonTransform } from "./plugin";

export type Tier = "Đồng" | "Bạc" | "Vàng" | "Kim Cương";
export type CustomerStatus = "active" | "vip" | "inactive";

export interface CustomerDoc {
  name: string;
  email: string;
  phone: string;
  avatar: string;
  tier: Tier;
  totalOrders: number;
  totalSpent: number;
  joinedAt: Date;
  lastOrderAt: Date | null;
  status: CustomerStatus;
}

const customerSchema = new Schema<CustomerDoc>({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, default: "" },
  avatar: { type: String, default: "" },
  tier: { type: String, enum: ["Đồng", "Bạc", "Vàng", "Kim Cương"], default: "Đồng" },
  totalOrders: { type: Number, default: 0, min: 0 },
  totalSpent: { type: Number, default: 0, min: 0 },
  joinedAt: { type: Date, default: Date.now },
  lastOrderAt: { type: Date, default: null },
  status: { type: String, enum: ["active", "vip", "inactive"], default: "active" },
});

applyJsonTransform(customerSchema);

export const Customer = model<CustomerDoc>("Customer", customerSchema);

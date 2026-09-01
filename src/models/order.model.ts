import { Schema, model, Types } from "mongoose";
import { applyJsonTransform } from "./plugin";

export type OrderType = "in_stock" | "pre_order";
export type OrderStatus =
  | "packing"
  | "deposit_received"
  | "factory_ordered"
  | "factory_shipped"
  | "transit_warehouse"
  | "vietnam_warehouse"
  | "shop_warehouse"
  | "shipped"
  | "picked_up"
  // Legacy values are kept so older records remain readable.
  | "pending"
  | "processing"
  | "delivered"
  | "cancelled";
export type PaymentMethod = "Chuyển khoản" | "COD" | "Thẻ tín dụng" | "Ví điện tử";
export type PaymentStatus = "not_deposited" | "deposited" | "paid" | "unpaid" | "refunded";

export interface OrderItemDoc {
  productId?: Types.ObjectId | null;
  slug: string;
  name: string;
  variantName: string;
  image: string;
  price: number;
  quantity: number;
  itemStatus?: OrderStatus;
}

export interface OrderDoc {
  publicCode: string;
  orderType: OrderType;
  facebookName: string;
  facebookUrl: string;
  customerName: string;
  recipientName: string;
  customerEmail: string;
  phone: string;
  addressFormat: "legacy_3_level" | "new_2_level";
  provinceCode: string;
  provinceName: string;
  districtCode: string;
  districtName: string;
  wardCode: string;
  wardName: string;
  addressDetail: string;
  /** Server-derived display line: `${addressDetail}, ${wardName}, ${provinceName}` — never trusted from the client. */
  shippingAddress: string;
  items: OrderItemDoc[];
  subtotal: number;
  shippingFee: number;
  tax?: number | null;
  discount: number;
  total: number;
  depositAmount: number;
  remainingAmount: number;
  status: OrderStatus;
  statusMode: "auto" | "manual";
  trackingCode: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  placedAt: Date;
  userId: Types.ObjectId | null;
  promotionCode?: string | null;
  promotionId?: Types.ObjectId | null;
  paymentProvider?: "payos" | null;
  paymentRef?: string | null;
  paidAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sourceOrderCode: string;
  splitOrderCodes: string[];
}

const orderItemSchema = new Schema<OrderItemDoc>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    slug: { type: String, default: "" },
    name: { type: String, required: true },
    variantName: { type: String, default: "", trim: true },
    image: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    itemStatus: {
      type: String,
      enum: ["packing", "deposit_received", "factory_ordered", "factory_shipped", "transit_warehouse", "vietnam_warehouse", "shop_warehouse", "shipped", "picked_up"],
      default: undefined,
    },
  },
  { _id: false },
);

const orderSchema = new Schema<OrderDoc>({
  publicCode: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  orderType: { type: String, enum: ["in_stock", "pre_order"], default: "in_stock" },
  facebookName: { type: String, default: "", trim: true },
  facebookUrl: { type: String, default: "", trim: true },
  customerName: { type: String, required: true },
  recipientName: { type: String, default: "", trim: true },
  customerEmail: { type: String, default: "", lowercase: true, trim: true },
  phone: { type: String, default: "" },
  addressFormat: { type: String, enum: ["legacy_3_level", "new_2_level"], default: "new_2_level" },
  provinceCode: { type: String, default: "" },
  provinceName: { type: String, default: "" },
  districtCode: { type: String, default: "" },
  districtName: { type: String, default: "" },
  wardCode: { type: String, default: "" },
  wardName: { type: String, default: "" },
  addressDetail: { type: String, default: "" },
  shippingAddress: { type: String, default: "" },
  items: { type: [orderItemSchema], required: true, validate: (v: unknown[]) => v.length > 0 },
  subtotal: { type: Number, required: true, min: 0 },
  shippingFee: { type: Number, default: 0, min: 0 },
  tax: { type: Number, default: null },
  discount: { type: Number, default: 0, min: 0 },
  total: { type: Number, required: true, min: 0 },
  depositAmount: { type: Number, default: 0, min: 0 },
  remainingAmount: { type: Number, default: 0, min: 0 },
  status: {
    type: String,
    enum: [
      "packing",
      "deposit_received",
      "factory_ordered",
      "factory_shipped",
      "transit_warehouse",
      "vietnam_warehouse",
      "shop_warehouse",
      "shipped",
      "picked_up",
      "pending",
      "processing",
      "delivered",
      "cancelled",
    ],
    default: "packing",
  },
  statusMode: { type: String, enum: ["auto", "manual"], default: "auto" },
  trackingCode: { type: String, default: "", trim: true },
  paymentMethod: {
    type: String,
    enum: ["Chuyển khoản", "COD", "Thẻ tín dụng", "Ví điện tử"],
    required: true,
  },
  paymentStatus: { type: String, enum: ["not_deposited", "deposited", "paid", "unpaid", "refunded"], default: "not_deposited" },
  placedAt: { type: Date, default: Date.now },
  userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  promotionCode: { type: String, default: null },
  promotionId: { type: Schema.Types.ObjectId, ref: "Promotion", default: null },
  paymentProvider: { type: String, enum: ["payos", null], default: null },
  paymentRef: { type: String, default: null },
  paidAt: { type: Date, default: null },
  sourceOrderCode: { type: String, default: "", lowercase: true, trim: true },
  splitOrderCodes: { type: [String], default: [] },
}, { timestamps: true });

// Lazily upgrades legacy orders whenever they are changed. Older records only had
// `unpaid`, even when depositAmount was greater than zero.
orderSchema.pre("save", function normalizeLegacyPaymentStatus() {
  if (this.paymentStatus !== "unpaid") return;
  if (this.total > 0 && this.depositAmount >= this.total) this.paymentStatus = "paid";
  else if (this.depositAmount > 0) this.paymentStatus = "deposited";
  else this.paymentStatus = "not_deposited";
});

applyJsonTransform(orderSchema);

export const Order = model<OrderDoc>("Order", orderSchema);

import { Schema, model } from "mongoose";
import { applyJsonTransform } from "./plugin";

export type TicketSubject = "order" | "return_warranty" | "product" | "payment" | "other";
export type TicketStatus = "open" | "in_progress" | "resolved";

export interface ContactTicketDoc {
  subject: TicketSubject;
  orderCode?: string | null;
  customerName: string;
  customerEmail: string;
  message: string;
  images: string[];
  status: TicketStatus;
  createdAt: Date;
  updatedAt: Date;
}

const contactTicketSchema = new Schema<ContactTicketDoc>(
  {
    subject: {
      type: String,
      enum: ["order", "return_warranty", "product", "payment", "other"],
      required: true,
    },
    orderCode: { type: String, default: null },
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true, lowercase: true, trim: true },
    message: { type: String, required: true },
    images: { type: [String], default: [] },
    status: { type: String, enum: ["open", "in_progress", "resolved"], default: "open" },
  },
  { timestamps: true },
);

applyJsonTransform(contactTicketSchema);

export const ContactTicket = model<ContactTicketDoc>("ContactTicket", contactTicketSchema);

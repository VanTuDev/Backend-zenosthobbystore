import { Schema, model } from "mongoose";
import { applyJsonTransform } from "./plugin";

export type Role = "ADMIN" | "CUSTOMER";

export interface UserDoc {
  email: string;
  name: string;
  avatarUrl?: string | null;
  googleId?: string | null;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    avatarUrl: { type: String, default: null },
    // No `default` on purpose — Mongoose would otherwise store an explicit
    // `null` on every doc, and a sparse unique index only skips fields that
    // are truly absent, not ones set to null (which would collide).
    googleId: { type: String, unique: true, sparse: true },
    role: { type: String, enum: ["ADMIN", "CUSTOMER"], default: "CUSTOMER" },
  },
  { timestamps: true },
);

applyJsonTransform(userSchema);

export const User = model<UserDoc>("User", userSchema);

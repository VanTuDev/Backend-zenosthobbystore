import { Schema, model, Types } from "mongoose";
import { applyJsonTransform } from "./plugin";

export interface CategoryDoc {
  name: string;
  slug: string;
  status: "active" | "hidden";
  description: string;
  image: string;
  parentId: Types.ObjectId | null;
  folderIds: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<CategoryDoc>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    status: { type: String, enum: ["active", "hidden"], default: "active" },
    description: { type: String, default: "" },
    image: { type: String, default: "" },
    parentId: { type: Schema.Types.ObjectId, ref: "Category", default: null },
    folderIds: [{ type: Schema.Types.ObjectId, ref: "Folder" }],
  },
  { timestamps: true },
);

applyJsonTransform(categorySchema);

export const Category = model<CategoryDoc>("Category", categorySchema);

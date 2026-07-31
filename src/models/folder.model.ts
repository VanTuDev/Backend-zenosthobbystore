import { Schema, model } from "mongoose";
import { applyJsonTransform } from "./plugin";

export interface FolderDoc {
  name: string;
  slug: string;
}

const folderSchema = new Schema<FolderDoc>({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
});

applyJsonTransform(folderSchema);

export const Folder = model<FolderDoc>("Folder", folderSchema);

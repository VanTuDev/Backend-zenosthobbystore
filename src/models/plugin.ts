import type { Schema } from "mongoose";

/** Shared `toJSON` shape: exposes a string `id`, hides Mongo's `_id`/`__v`. */
export function applyJsonTransform(schema: Schema) {
  schema.set("toJSON", {
    virtuals: true,
    versionKey: false,
    transform: (_doc, ret: Record<string, unknown>) => {
      ret.id = String(ret._id);
      delete ret._id;
    },
  });
}

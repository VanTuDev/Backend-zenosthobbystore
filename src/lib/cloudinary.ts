import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { env, isCloudinaryConfigured } from "../config/env";

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: env.cloudinaryCloudName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret,
    secure: true,
  });
}

/** Streams a buffer (e.g. from multer memory storage) up to Cloudinary. */
export function uploadImageBuffer(buffer: Buffer, folder = "zenosthobbystore/products"): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder, resource_type: "image" }, (err, result) => {
      if (err || !result) return reject(err ?? new Error("Cloudinary upload failed with no result"));
      resolve(result);
    });
    stream.end(buffer);
  });
}

export function deleteImage(publicId: string): Promise<unknown> {
  return cloudinary.uploader.destroy(publicId);
}

/** Verifies the configured Cloudinary credentials actually authenticate, not just that they're present. */
export async function pingCloudinary(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await cloudinary.api.ping();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

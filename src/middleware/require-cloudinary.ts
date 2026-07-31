import type { NextFunction, Request, Response } from "express";
import { isCloudinaryConfigured } from "../config/env";

/** Short-circuits with a clear 503 until CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET are all set. */
export function requireCloudinary(_req: Request, res: Response, next: NextFunction) {
  if (!isCloudinaryConfigured) {
    return res.status(503).json({
      error:
        "Chưa cấu hình đầy đủ Cloudinary (thiếu CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET). Vui lòng cấu hình rồi khởi động lại server.",
    });
  }
  next();
}

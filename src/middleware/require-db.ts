import type { NextFunction, Request, Response } from "express";
import { isDbConnected } from "../lib/db";
import { isMongoConfigured } from "../config/env";

/** Short-circuits with a clear 503 instead of hanging/500-ing when Atlas isn't wired up yet. */
export function requireDb(_req: Request, res: Response, next: NextFunction) {
  if (!isMongoConfigured || !isDbConnected()) {
    return res.status(503).json({
      error:
        "Chưa kết nối được cơ sở dữ liệu — thiếu MONGODB_URI (MongoDB Atlas). Vui lòng cấu hình rồi khởi động lại server.",
    });
  }
  next();
}

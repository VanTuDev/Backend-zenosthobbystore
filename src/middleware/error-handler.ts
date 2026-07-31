import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { MulterError } from "multer";
import { ZodError } from "zod";
import { ApiError } from "../utils/api-error";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Không tìm thấy route ${req.method} ${req.path}` });
}

type MongoDuplicateKeyError = { code: number; keyValue?: Record<string, unknown> };

function isDuplicateKeyError(err: unknown): err is MongoDuplicateKeyError {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Dữ liệu không hợp lệ", details: err.flatten() });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ error: "Dữ liệu không hợp lệ", details: err.errors });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: `ID không hợp lệ: ${err.value}` });
  }
  if (isDuplicateKeyError(err)) {
    const field = Object.keys(err.keyValue ?? {})[0] ?? "trường";
    return res.status(409).json({ error: `Giá trị "${field}" đã tồn tại.` });
  }
  if (err instanceof MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "File ảnh vượt quá 5MB." : err.message;
    return res.status(400).json({ error: message });
  }
  console.error(err);
  return res.status(500).json({ error: "Đã xảy ra lỗi hệ thống" });
}

import { Router } from "express";
import multer from "multer";
import { attachUser, requireAdmin } from "../middleware/auth";
import { requireCloudinary } from "../middleware/require-cloudinary";
import { deleteImage, uploadImageBuffer } from "../lib/cloudinary";
import { ApiError } from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";

export const uploadsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(ApiError.badRequest("Chỉ chấp nhận file ảnh."));
    }
    cb(null, true);
  },
});

/** Admin-only: upload a product image, returns the Cloudinary URL + public ID to store on the product. */
uploadsRouter.post(
  "/image",
  attachUser,
  requireAdmin,
  requireCloudinary,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest("Thiếu file ảnh (field 'file').");
    const result = await uploadImageBuffer(req.file.buffer);
    res.status(201).json({ url: result.secure_url, publicId: result.public_id });
  }),
);

uploadsRouter.delete(
  "/image/:publicId",
  attachUser,
  requireAdmin,
  requireCloudinary,
  asyncHandler(async (req, res) => {
    // publicId may contain slashes (folder path) — client sends it URL-encoded.
    await deleteImage(decodeURIComponent(req.params.publicId));
    res.status(204).end();
  }),
);

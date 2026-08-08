import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { attachUser, requireAdmin, requireAuth } from "../middleware/auth";
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

// Public, unauthenticated upload route — tighter limiter than the global one to deter abuse.
const contactImageLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

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

/** Any signed-in customer: upload a photo to attach to a product review. Kept separate from the admin product-image route (different auth level, different Cloudinary folder). */
uploadsRouter.post(
  "/review-image",
  attachUser,
  requireAuth,
  requireCloudinary,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest("Thiếu file ảnh (field 'file').");
    const result = await uploadImageBuffer(req.file.buffer, "zenosthobbystore/reviews");
    res.status(201).json({ url: result.secure_url, publicId: result.public_id });
  }),
);

/** Public: attach a photo to a support ticket on the "Liên hệ" form — no login required to ask for support. */
uploadsRouter.post(
  "/contact-image",
  contactImageLimiter,
  requireCloudinary,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest("Thiếu file ảnh (field 'file').");
    const result = await uploadImageBuffer(req.file.buffer, "zenosthobbystore/contact-tickets");
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

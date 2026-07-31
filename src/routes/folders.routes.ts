import { Router } from "express";
import { z } from "zod";
import { attachUser, requireAdmin } from "../middleware/auth";
import { requireDb } from "../middleware/require-db";
import { Folder } from "../models/folder.model";
import { ApiError } from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";
import { slugify } from "../utils/slugify";

export const foldersRouter = Router();
foldersRouter.use(requireDb);

const folderSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
});

foldersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const folders = await Folder.find().sort({ name: 1 });
    res.json({ folders });
  }),
);

foldersRouter.post(
  "/",
  attachUser,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = folderSchema.parse(req.body);
    const slug = body.slug?.trim() || slugify(body.name);

    const existing = await Folder.findOne({ slug });
    if (existing) throw ApiError.conflict(`Slug "${slug}" đã tồn tại.`);

    const folder = await Folder.create({ name: body.name, slug });
    res.status(201).json({ folder });
  }),
);

foldersRouter.put(
  "/:id",
  attachUser,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = folderSchema.partial().parse(req.body);

    const existing = await Folder.findById(id);
    if (!existing) throw ApiError.notFound("Không tìm thấy thư mục.");

    if (body.slug && body.slug !== existing.slug) {
      const clash = await Folder.findOne({ slug: body.slug });
      if (clash) throw ApiError.conflict(`Slug "${body.slug}" đã tồn tại.`);
    }

    Object.assign(existing, body);
    await existing.save();
    res.json({ folder: existing });
  }),
);

foldersRouter.delete(
  "/:id",
  attachUser,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const existing = await Folder.findByIdAndDelete(req.params.id);
    if (!existing) throw ApiError.notFound("Không tìm thấy thư mục.");
    res.status(204).end();
  }),
);

import { Router } from "express";
import { z } from "zod";
import { attachUser, requireAdmin } from "../middleware/auth";
import { requireDb } from "../middleware/require-db";
import { User } from "../models/user.model";
import { ApiError } from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";
import { getPagination, paginatedResponse } from "../utils/pagination";

export const usersRouter = Router();
usersRouter.use(requireDb, attachUser, requireAdmin);

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

usersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { q, role } = req.query as Record<string, string | undefined>;
    const pagination = getPagination(req);

    const filter: Record<string, unknown> = {};
    if (role === "ADMIN" || role === "CUSTOMER") filter.role = role;
    if (q?.trim()) {
      const re = new RegExp(escapeRegex(q.trim()), "i");
      filter.$or = [{ name: re }, { email: re }];
    }

    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.pageSize),
      User.countDocuments(filter),
    ]);

    res.json(paginatedResponse(users, total, pagination));
  }),
);

const roleSchema = z.object({ role: z.enum(["ADMIN", "CUSTOMER"]) });

/** Promote/demote a user. Separate from a generic PUT since role is the one field admins should be changing here. */
usersRouter.patch(
  "/:id/role",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { role } = roleSchema.parse(req.body);

    if (id === req.user!.sub && role !== "ADMIN") {
      throw ApiError.badRequest("Không thể tự bỏ quyền quản trị của chính mình.");
    }

    const user = await User.findById(id);
    if (!user) throw ApiError.notFound("Không tìm thấy người dùng.");

    user.role = role;
    await user.save();
    res.json({ user });
  }),
);

usersRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (id === req.user!.sub) throw ApiError.badRequest("Không thể tự xóa tài khoản của chính mình.");

    const user = await User.findByIdAndDelete(id);
    if (!user) throw ApiError.notFound("Không tìm thấy người dùng.");
    res.status(204).end();
  }),
);

import { Router } from "express";
import { z } from "zod";
import { attachUser, requireAdmin } from "../middleware/auth";
import { requireDb } from "../middleware/require-db";
import { Customer } from "../models/customer.model";
import { ApiError } from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";
import { getPagination, paginatedResponse } from "../utils/pagination";

export const customersRouter = Router();

customersRouter.use(requireDb, attachUser, requireAdmin);

const customerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().default(""),
  avatar: z.string().default(""),
  tier: z.enum(["Đồng", "Bạc", "Vàng", "Kim Cương"]).default("Đồng"),
  totalOrders: z.number().int().nonnegative().default(0),
  totalSpent: z.number().int().nonnegative().default(0),
  status: z.enum(["active", "vip", "inactive"]).default("active"),
});

customersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status, tier } = req.query as Record<string, string | undefined>;
    const pagination = getPagination(req);
    const filter = { ...(status ? { status } : {}), ...(tier ? { tier } : {}) };

    const [customers, total] = await Promise.all([
      Customer.find(filter).sort({ joinedAt: -1 }).skip(pagination.skip).limit(pagination.pageSize),
      Customer.countDocuments(filter),
    ]);

    res.json(paginatedResponse(customers, total, pagination));
  }),
);

customersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const customer = await Customer.findById(req.params.id);
    if (!customer) throw ApiError.notFound("Không tìm thấy khách hàng.");
    res.json({ customer });
  }),
);

customersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = customerSchema.parse(req.body);
    const existing = await Customer.findOne({ email: body.email.toLowerCase() });
    if (existing) throw ApiError.conflict(`Email "${body.email}" đã tồn tại.`);
    const customer = await Customer.create(body);
    res.status(201).json({ customer });
  }),
);

customersRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = customerSchema.partial().parse(req.body);

    const existing = await Customer.findById(id);
    if (!existing) throw ApiError.notFound("Không tìm thấy khách hàng.");

    if (body.email && body.email.toLowerCase() !== existing.email) {
      const clash = await Customer.findOne({ email: body.email.toLowerCase() });
      if (clash) throw ApiError.conflict(`Email "${body.email}" đã tồn tại.`);
    }

    Object.assign(existing, body);
    await existing.save();
    res.json({ customer: existing });
  }),
);

customersRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await Customer.findByIdAndDelete(req.params.id);
    if (!existing) throw ApiError.notFound("Không tìm thấy khách hàng.");
    res.status(204).end();
  }),
);

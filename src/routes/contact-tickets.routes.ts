import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { attachUser, requireAdmin } from "../middleware/auth";
import { requireDb } from "../middleware/require-db";
import { ContactTicket } from "../models/contact-ticket.model";
import { ApiError } from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";
import { getPagination, paginatedResponse } from "../utils/pagination";

export const contactTicketsRouter = Router();
contactTicketsRouter.use(requireDb);

// The submit endpoint is public (no login needed to ask for support) — a tighter limiter than the
// global one keeps it from being abused as an anonymous mail-bomb/spam vector.
const submitLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

const ticketSchema = z.object({
  subject: z.enum(["order", "return_warranty", "product", "payment", "other"]),
  orderCode: z.string().trim().max(64).optional(),
  customerName: z.string().trim().min(1).max(200),
  customerEmail: z.string().trim().email(),
  message: z.string().trim().min(1).max(4000),
  images: z.array(z.string().url()).max(3).default([]),
});

/** Public — the "Gửi yêu cầu hỗ trợ" form on /lien-he, no login required. */
contactTicketsRouter.post(
  "/",
  submitLimiter,
  asyncHandler(async (req, res) => {
    const body = ticketSchema.parse(req.body);
    const ticket = await ContactTicket.create({ ...body, orderCode: body.orderCode || null });
    res.status(201).json({ ticket });
  }),
);

contactTicketsRouter.use(attachUser, requireAdmin);

const statusSchema = z.object({ status: z.enum(["open", "in_progress", "resolved"]) });

/** Admin inbox for tickets submitted from the storefront contact form. */
contactTicketsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status } = req.query as Record<string, string | undefined>;
    const pagination = getPagination(req);
    const filter = status ? { status } : {};

    const [tickets, total] = await Promise.all([
      ContactTicket.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.pageSize),
      ContactTicket.countDocuments(filter),
    ]);

    res.json(paginatedResponse(tickets, total, pagination));
  }),
);

contactTicketsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const ticket = await ContactTicket.findById(req.params.id);
    if (!ticket) throw ApiError.notFound("Không tìm thấy yêu cầu hỗ trợ.");
    res.json({ ticket });
  }),
);

contactTicketsRouter.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const { status } = statusSchema.parse(req.body);
    const ticket = await ContactTicket.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!ticket) throw ApiError.notFound("Không tìm thấy yêu cầu hỗ trợ.");
    res.json({ ticket });
  }),
);

contactTicketsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await ContactTicket.findByIdAndDelete(req.params.id);
    if (!existing) throw ApiError.notFound("Không tìm thấy yêu cầu hỗ trợ.");
    res.status(204).end();
  }),
);

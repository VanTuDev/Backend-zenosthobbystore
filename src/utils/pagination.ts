import type { Request } from "express";

export type Pagination = { page: number; pageSize: number; skip: number };

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Reads `?page=&pageSize=` from the query string with sane, clamped defaults. */
export function getPagination(req: Request): Pagination {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || DEFAULT_PAGE_SIZE));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function paginatedResponse<T>(items: T[], total: number, { page, pageSize }: Pagination) {
  return {
    items,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

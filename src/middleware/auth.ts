import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/api-error";
import { verifySession, type SessionPayload } from "../utils/jwt";

const COOKIE_NAME = "zenos_session";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionPayload;
    }
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;

function extractToken(req: Request): string | null {
  const cookieToken = req.cookies?.[COOKIE_NAME];
  if (cookieToken) return cookieToken;

  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);

  return null;
}

/** Attaches `req.user` when a valid session is present; does not reject anonymous requests. */
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (token) {
    try {
      req.user = verifySession(token);
    } catch {
      // expired/invalid token — treat as anonymous rather than erroring the whole request
    }
  }
  next();
}

/** Rejects the request unless a valid session is present. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(ApiError.unauthorized("Bạn cần đăng nhập để thực hiện thao tác này."));
  next();
}

/** Rejects the request unless the session belongs to an ADMIN user. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(ApiError.unauthorized("Bạn cần đăng nhập để thực hiện thao tác này."));
  if (req.user.role !== "ADMIN") return next(ApiError.forbidden("Chỉ quản trị viên mới có quyền này."));
  next();
}

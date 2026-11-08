import type { RequestHandler } from "express";
import baseRateLimit, { type Options } from "express-rate-limit";

/**
 * Drop-in for `express-rate-limit`'s default export that builds the real limiter on first use
 * instead of at module load. The library starts a timer when a limiter is created, and Cloudflare
 * Workers forbid timers/I-O in global scope — this keeps module load side-effect free on both
 * runtimes (Node behaves exactly as before).
 */
export function rateLimit(options: Partial<Options>): RequestHandler {
  let limiter: RequestHandler | undefined;
  return (req, res, next) => {
    // `creationStack: false` — the library warns about limiters built inside a request; that is
    // exactly the point of this lazy wrapper, so the check is intentionally disabled.
    limiter ??= baseRateLimit({ validate: { creationStack: false }, ...options });
    return limiter(req, res, next);
  };
}

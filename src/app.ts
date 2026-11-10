import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { rateLimit } from "./lib/rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import { env, isCorsOriginAllowed } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { authRouter } from "./routes/auth.routes";
import { categoriesRouter } from "./routes/categories.routes";
import { contactTicketsRouter } from "./routes/contact-tickets.routes";
import { customersRouter } from "./routes/customers.routes";
import { financeRouter } from "./routes/finance.routes";
import { favoritesRouter } from "./routes/favorites.routes";
import { foldersRouter } from "./routes/folders.routes";
import { healthRouter } from "./routes/health.routes";
import { locationsRouter } from "./routes/locations.routes";
import { ordersRouter } from "./routes/orders.routes";
import { paymentsRouter } from "./routes/payments.routes";
import { productsRouter } from "./routes/products.routes";
import { promotionsRouter } from "./routes/promotions.routes";
import { uploadsRouter } from "./routes/uploads.routes";
import { usersRouter } from "./routes/users.routes";

// Generous global ceiling; auth gets a tighter one below since login endpoints
// are the highest-value target for brute-forcing/credential stuffing.
const skipRateLimitOutsideProduction = () => env.nodeEnv !== "production";
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false, skip: skipRateLimitOutsideProduction });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, skip: skipRateLimitOutsideProduction });

export type CreateAppOptions = {
  /**
   * HTTP access log via morgan. Off on Cloudflare Workers: morgan compiles its format with
   * `new Function`, which workerd forbids, and Workers already logs every request itself.
   */
  requestLogger?: boolean;
  /** App-level gzip. Off on Workers: Cloudflare already compresses at the edge. */
  compress?: boolean;
};

export function createApp({ requestLogger = true, compress = true }: CreateAppOptions = {}) {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      // Function form so several origins (apex, www, Vercel previews) can be allowed — see
      // isCorsOriginAllowed in config/env.ts. Requests without an Origin header (server-to-server,
      // curl, health checks) pass. A disallowed browser origin simply gets no CORS headers, so the
      // browser blocks it; we don't turn it into a 500.
      origin: (origin, callback) => callback(null, !origin || isCorsOriginAllowed(origin)),
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      // Cache preflights for a day so the browser doesn't re-ask before every API call.
      maxAge: 86400,
      optionsSuccessStatus: 204,
    }),
  );
  if (compress) app.use(compression());
  if (requestLogger && env.nodeEnv !== "test") app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(globalLimiter);

  app.use(healthRouter);

  app.use("/auth", authLimiter, authRouter);
  app.use("/products", productsRouter);
  app.use("/categories", categoriesRouter);
  app.use("/folders", foldersRouter);
  app.use("/locations", locationsRouter);
  app.use("/customers", customersRouter);
  app.use("/contact-tickets", contactTicketsRouter);
  app.use("/orders", ordersRouter);
  app.use("/promotions", promotionsRouter);
  app.use("/finance", financeRouter);
  app.use("/favorites", favoritesRouter);
  app.use("/payments", paymentsRouter);
  app.use("/uploads", uploadsRouter);
  app.use("/users", usersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

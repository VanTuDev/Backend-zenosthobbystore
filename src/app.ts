import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import { env, isCloudinaryConfigured, isGoogleOAuthConfigured, isMongoConfigured } from "./config/env";
import { isDbConnected } from "./lib/db";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { authRouter } from "./routes/auth.routes";
import { categoriesRouter } from "./routes/categories.routes";
import { contactTicketsRouter } from "./routes/contact-tickets.routes";
import { customersRouter } from "./routes/customers.routes";
import { financeRouter } from "./routes/finance.routes";
import { foldersRouter } from "./routes/folders.routes";
import { locationsRouter } from "./routes/locations.routes";
import { ordersRouter } from "./routes/orders.routes";
import { paymentsRouter } from "./routes/payments.routes";
import { productsRouter } from "./routes/products.routes";
import { promotionsRouter } from "./routes/promotions.routes";
import { uploadsRouter } from "./routes/uploads.routes";
import { usersRouter } from "./routes/users.routes";

// Generous global ceiling; auth gets a tighter one below since login endpoints
// are the highest-value target for brute-forcing/credential stuffing.
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      // Function form (not the plain string the `cors` package also accepts) so more than one
      // origin can be allowed — see env.corsOrigins in config/env.ts.
      origin: (origin, callback) => {
        if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`Origin "${origin}" not allowed by CORS`));
      },
      credentials: true,
    }),
  );
  app.use(compression());
  if (env.nodeEnv !== "test") app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(globalLimiter);

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      googleOAuthConfigured: isGoogleOAuthConfigured,
      mongoConfigured: isMongoConfigured,
      dbConnected: isDbConnected(),
      cloudinaryConfigured: isCloudinaryConfigured,
    });
  });

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
  app.use("/payments", paymentsRouter);
  app.use("/uploads", uploadsRouter);
  app.use("/users", usersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

import { Router } from "express";
import mongoose from "mongoose";
import { isCloudinaryConfigured, isGoogleOAuthConfigured, isMongoConfigured } from "../config/env";
import { isDbConnected } from "../lib/db";

export const healthRouter = Router();

const PING_TIMEOUT_MS = 3000;

/** Real round-trip to MongoDB (readyState alone can be stale). Never throws. */
async function pingDb(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  if (!isDbConnected() || !mongoose.connection.db) return { ok: false, error: "not connected" };
  const startedAt = Date.now();
  try {
    await Promise.race([
      mongoose.connection.db.admin().ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("ping timeout")), PING_TIMEOUT_MS)),
    ]);
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "ping failed" };
  }
}

/**
 * Liveness — "is the process up and answering?". Cheap, no DB call, always 200 while the server
 * runs. Point Render's Health Check Path and uptime pingers (UptimeRobot, ...) here.
 */
healthRouter.get("/health", (_req, res) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.round(process.uptime()),
    googleOAuthConfigured: isGoogleOAuthConfigured,
    mongoConfigured: isMongoConfigured,
    dbConnected: isDbConnected(),
    cloudinaryConfigured: isCloudinaryConfigured,
  });
});

/**
 * Readiness — "can it actually serve catalog requests?". Pings MongoDB; responds 503 when the
 * database is unreachable, so the frontend health check (and monitors) can tell
 * "backend up but DB down" apart from "backend down".
 */
healthRouter.get("/health/ready", async (_req, res) => {
  const db = await pingDb();
  res.status(db.ok ? 200 : 503).json({
    ok: db.ok,
    db,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

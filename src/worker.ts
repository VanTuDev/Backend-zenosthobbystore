/**
 * Cloudflare Workers entry. Wraps the exact same Express app the Node entry (src/index.ts) uses.
 * Config: wrangler.jsonc. Dev: `npm run cf:dev`. Deploy: `npm run cf:deploy`.
 *
 * Differences from the long-running Node server, handled here rather than in app code:
 *  - No signals / process lifecycle — `httpServerHandler` routes Worker fetches into Express
 *    (listen + handler must be created in global scope, per Cloudflare's node:http support).
 *  - Workers forbid reusing an I/O object (our MongoDB sockets) across requests, so the DB
 *    connection is opened per request and closed before the response ends (see `withDb`).
 */
import { httpServerHandler } from "cloudflare:node";
import express from "express";
import mongoose from "mongoose";
import { createApp } from "./app";
import { env, isMongoConfigured } from "./config/env";

// One request at a time touches MongoDB inside an isolate. Workers forbid (a) sharing a socket
// across requests and (b) a request awaiting a promise that only another request resolves (the
// runtime then flags it as "hung"), so waiters poll with their own timers instead of awaiting a
// shared promise. Each holder opens the connection, runs, and closes it BEFORE the response ends
// (work after the response is cancelled by the runtime and would leak a half-dead socket).
let lockedSince = 0;
const LOCK_STALE_MS = 30_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function closeDb() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => undefined);
}

const withDb: express.RequestHandler = async (req, res, next) => {
  // CORS preflights and the liveness probe never touch MongoDB — skip the (slow) per-request connect.
  if (!isMongoConfigured || req.method === "OPTIONS" || req.path === "/health") return next();
  try {
    while (lockedSince && Date.now() - lockedSince < LOCK_STALE_MS) await sleep(15);
    const myLock = Date.now();
    lockedSince = myLock;
    const release = () => {
      if (lockedSince === myLock) lockedSince = 0;
    };
    res.on("close", release);

    const originalEnd = res.end.bind(res) as (...args: unknown[]) => unknown;
    res.end = ((...args: unknown[]) => {
      void closeDb().finally(() => originalEnd(...args));
      return res;
    }) as typeof res.end;

    await closeDb(); // drop anything left over from a previous (possibly cancelled) request
    await mongoose
      .connect(env.mongodbUri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 })
      .catch((err) => console.error("MongoDB connect failed:", err));
    next();
  } catch (err) {
    next(err);
  }
};

const root = express();
root.use(withDb);
root.use(createApp({ requestLogger: false, compress: false }));
root.listen(env.port);

export default httpServerHandler({ port: env.port });

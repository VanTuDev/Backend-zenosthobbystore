import { createApp } from "./app";
import { env } from "./config/env";
import { connectDb, disconnectDb } from "./lib/db";
import { runStartupChecks } from "./lib/startup-checks";

async function main() {
  await connectDb();

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`ZENOS backend listening on http://localhost:${env.port}`);
    void runStartupChecks();
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down...`);
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

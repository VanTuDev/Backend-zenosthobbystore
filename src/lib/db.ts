import mongoose from "mongoose";
import { env, isMongoConfigured } from "../config/env";

/**
 * Connects to MongoDB Atlas. Deliberately never throws — whether
 * MONGODB_URI is unset, DNS/network fails, or credentials are wrong, the
 * server still boots (health checks, static routes, Google OAuth setup all
 * work) instead of crash-looping. Any request that touches the database
 * fails with a clear 503 until the connection is actually up (see
 * `requireDb` below); check `/health` or the startup log for *why*.
 */
export async function connectDb(): Promise<void> {
  if (!isMongoConfigured) {
    console.warn(
      "MONGODB_URI chưa được cấu hình — API sẽ chạy nhưng mọi request cần DB sẽ trả lỗi 503 cho đến khi bạn cung cấp connection string MongoDB Atlas.",
    );
    return;
  }

  mongoose.connection.on("error", (err) => console.error("MongoDB connection error:", err));
  mongoose.connection.on("disconnected", () => console.warn("MongoDB disconnected."));

  try {
    await mongoose.connect(env.mongodbUri);
    console.log(`MongoDB connected (db: ${mongoose.connection.name})`);
  } catch (err) {
    console.error(
      "Không thể kết nối MongoDB Atlas — kiểm tra lại MONGODB_URI (user/password/cluster), Network Access allowlist trên Atlas, và DNS/mạng của máy chạy server. Server vẫn chạy nhưng mọi request cần DB sẽ trả 503.",
      err,
    );
  }
}

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function disconnectDb(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
}

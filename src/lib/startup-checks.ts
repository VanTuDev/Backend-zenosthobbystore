import {
  env,
  isCloudinaryConfigured,
  isGoogleOAuthConfigured,
  isMongoConfigured,
} from "../config/env";
import { isDbConnected } from "./db";
import { pingCloudinary } from "./cloudinary";

type CheckResult = { name: string; ok: boolean; detail: string };

const CHECK = "✓";
const CROSS = "✗";

async function checkMongo(): Promise<CheckResult> {
  if (!isMongoConfigured) {
    return { name: "MongoDB Atlas", ok: false, detail: "MONGODB_URI chưa được cấu hình" };
  }
  const ok = isDbConnected();
  return {
    name: "MongoDB Atlas",
    ok,
    detail: ok ? "kết nối + xác thực thành công" : "kết nối thất bại — xem log lỗi phía trên",
  };
}

async function checkGoogleOAuth(): Promise<CheckResult> {
  if (!isGoogleOAuthConfigured) {
    return {
      name: "Google OAuth",
      ok: false,
      detail: "thiếu GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET — dùng /auth/dev-login tạm",
    };
  }
  const looksValid = env.googleClientId.endsWith(".apps.googleusercontent.com");
  return {
    name: "Google OAuth",
    ok: looksValid,
    detail: looksValid
      ? "client_id/secret đã cấu hình (chỉ xác thực được đầy đủ khi có người thật đăng nhập qua /auth/google)"
      : "GOOGLE_CLIENT_ID có định dạng bất thường, kiểm tra lại giá trị",
  };
}

async function checkCloudinary(): Promise<CheckResult> {
  if (!isCloudinaryConfigured) {
    return {
      name: "Cloudinary",
      ok: false,
      detail: "thiếu CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET",
    };
  }
  const result = await pingCloudinary();
  return {
    name: "Cloudinary",
    ok: result.ok,
    detail: result.ok ? "kết nối + xác thực thành công (api.ping)" : `xác thực thất bại — ${result.error}`,
  };
}

/** Runs every external-service check and logs a clean pass/fail summary at startup. */
export async function runStartupChecks(): Promise<void> {
  const results = await Promise.all([checkMongo(), checkGoogleOAuth(), checkCloudinary()]);

  console.log("\n=== ZENOS backend — kiểm tra kết nối ===");
  for (const r of results) {
    console.log(`  [${r.ok ? CHECK : CROSS}] ${r.name}: ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(
    failed.length === 0
      ? "Tất cả kết nối OK.\n"
      : `${failed.length}/${results.length} kết nối chưa sẵn sàng (xem chi tiết ở trên).\n`,
  );
}

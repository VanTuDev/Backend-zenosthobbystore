# Deploy backend lên Cloudflare Workers

Entry: `src/worker.ts` (bọc cùng app Express với `src/index.ts`). Cấu hình: `wrangler.jsonc`.
Node entry (`npm start`, Render) vẫn dùng được song song.

## Lệnh
- `npx wrangler login` — đăng nhập một lần.
- `npm run cf:dev` — chạy thử cục bộ bằng workerd (đọc secret từ `.dev.vars` hoặc `.env`, đều đã gitignore).
- `npm run cf:deploy` — deploy.

## Biến môi trường
- Không bí mật: nằm trong `vars` của `wrangler.jsonc` (NODE_ENV, CORS_ORIGIN, GOOGLE_CLIENT_ID,
  GOOGLE_REDIRECT_URI, CLOUDINARY_CLOUD_NAME, ALLOW_DEV_LOGIN=false...).
- Bí mật — đặt bằng `npx wrangler secret put <TÊN>` (hoặc `secret bulk file.json`), KHÔNG ghi vào repo:
  `MONGODB_URI`, `JWT_SECRET`, `GOOGLE_CLIENT_SECRET`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
- Đổi domain Worker thì cập nhật `GOOGLE_REDIRECT_URI` và thêm URI đó vào Google Cloud Console.

## Khác biệt so với Node (xem comment trong `src/worker.ts`)
- MongoDB mở/đóng kết nối theo từng request (Workers cấm dùng lại socket giữa các request);
  request đồng thời trong cùng instance được xếp hàng.
- Tắt morgan và compression (workerd cấm `new Function`; Cloudflare tự nén ở edge).
- `express-rate-limit` chỉ đếm trong bộ nhớ từng instance.
- Dùng bản Node của `mongoose` và shim `iconv-lite` qua `alias` trong `wrangler.jsonc`.

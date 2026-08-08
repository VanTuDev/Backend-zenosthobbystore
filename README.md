# ZENOS Hobby Store — Backend

Express + TypeScript + **MongoDB (Atlas)** API for the storefront/admin frontend. Provides Google
OAuth login and CRUD endpoints for everything the admin dashboard manages.

## Stack

- **Express 4** + **TypeScript**
- **Mongoose** on **MongoDB Atlas** — connection string is not set yet (waiting on the key); the
  server still boots without it, see [Running without Atlas yet](#running-without-atlas-yet)
- **JWT** session in an httpOnly cookie (`zenos_session`) — no server-side session store needed
- **Zod** request validation
- **Helmet**, **express-rate-limit** (tighter limit on `/auth/*`), **compression**, **morgan**
  request logging

## Getting started

```bash
npm install
cp .env.example .env
```

### Once you have the MongoDB Atlas connection string

1. Paste it into `.env` as `MONGODB_URI` (format in the comment above it in `.env.example`).
2. Make sure the Atlas cluster's Network Access list allows this machine's IP (or `0.0.0.0/0` for
   local dev).
3. Seed mock data: `npm run seed` (destructive — wipes and recreates every collection).
4. `npm run dev` → http://localhost:4000

### Running without Atlas yet

`npm run dev` works right now with `MONGODB_URI` empty: the server boots, `/health` reports
`mongoConfigured: false`, and any route that touches the database returns a clear `503` instead of
crashing. This is intentional so the rest of the API (and the frontend integration) can be wired
up before the key arrives. The same graceful behavior applies if `MONGODB_URI` **is** set but the
connection fails (bad password, IP not allowlisted, DNS issue, cluster paused, ...) — the server
still boots, logs the specific Mongo error once, and `/health.dbConnected` stays `false` until a
retry (restart) succeeds. Check the startup log for the underlying error when debugging.

> **`querySrv ECONNREFUSED` on `mongodb+srv://...`?** Some restricted/sandboxed networks (proxied
> DNS, no outbound SRV/UDP) can't resolve the `mongodb+srv://` shorthand even though the cluster
> itself is reachable. Workaround: resolve the SRV/TXT records once from a machine that *can*
> (`nslookup -type=SRV _mongodb._tcp.<cluster-host>` and `nslookup -type=TXT <cluster-host>`) and
> build the equivalent standard `mongodb://host1:27017,host2:27017,host3:27017/<db>?ssl=true&replicaSet=<from TXT>&authSource=admin` URI instead — only needed as a local workaround, real hosting
> platforms resolve SRV records fine.

To actually exercise the CRUD logic locally without Atlas, run the smoke test — it spins up a
throwaway **in-memory** MongoDB instance, boots the real app against it, and walks through
auth + every resource's CRUD:

```bash
npm run smoke
```

## Auth

### Google OAuth (real login)

`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are **not set yet** — waiting on keys. Once issued:

1. Fill them into `.env` along with `GOOGLE_REDIRECT_URI` (must exactly match the redirect URI
   authorized in Google Cloud Console — defaults to `http://localhost:4000/auth/google/callback`).
2. Flow: browser hits `GET /auth/google` → redirected to Google's consent screen → Google calls
   back `GET /auth/google/callback?code=...` → server exchanges the code, upserts a `User`, sets
   the `zenos_session` cookie, redirects to `FRONTEND_LOGIN_SUCCESS_URL`.
3. Until the keys are set, `GET /auth/google` responds `501` so the frontend can fall back to dev
   login instead of hanging.

### Dev login (works once Atlas is connected, no Google keys needed)

```
POST /auth/dev-login
Content-Type: application/json
{ "email": "admin@zenoshobbystore.vn", "name": "ZENOS Admin" }
```

Upserts a `User` by email and sets the same session cookie real Google login would. **Never grants
ADMIN by itself** — a brand-new email always comes back as `CUSTOMER`; only an already-seeded
admin account (or one promoted by hand in the DB) gets `ADMIN` from dev-login. Disable dev-login
entirely in any shared/production environment via `ALLOW_DEV_LOGIN=false`.

The seeded admin account is `admin@zenoshobbystore.vn` (role `ADMIN`); any other email dev-logs in
as a plain `CUSTOMER`.

### Other auth endpoints

- `GET /auth/me` — current session's user (401 if not logged in)
- `POST /auth/logout` — clears the session cookie

Frontend calls must use `credentials: "include"` (cookie-based session) — `CORS_ORIGIN` is
already set up for `http://localhost:3000` with `credentials: true`.

## Authorization model

- `User.role` is `ADMIN` or `CUSTOMER`.
- Public (no auth): browse products, categories, folders, look up a promo code.
- Signed-in user (any role): `POST /orders` (checkout).
- `ADMIN` only: all writes on products/categories/folders, and everything under
  customers/promotions/finance (reads included), plus listing/updating/deleting orders.

## Endpoints

| Resource | Routes |
|---|---|
| Auth | `GET /auth/google`, `GET /auth/google/callback`, `POST /auth/dev-login`, `GET /auth/me`, `POST /auth/logout` |
| Products | `GET /products`, `GET /products/:idOrSlug`, `POST /products` 🔒, `PUT /products/:id` 🔒, `DELETE /products/:id` 🔒 |
| Categories | `GET /categories`, `GET /categories/:id`, `POST /categories` 🔒, `PUT /categories/:id` 🔒, `DELETE /categories/:id` 🔒 |
| Folders | `GET /folders`, `POST /folders` 🔒, `PUT /folders/:id` 🔒, `DELETE /folders/:id` 🔒 |
| Customers | `GET /customers` 🔒, `GET /customers/:id` 🔒, `POST /customers` 🔒, `PUT /customers/:id` 🔒, `DELETE /customers/:id` 🔒 |
| Contact tickets | `POST /contact-tickets` (public, "Liên hệ" form), `GET /contact-tickets` 🔒, `GET /contact-tickets/:id` 🔒, `PATCH /contact-tickets/:id/status` 🔒, `DELETE /contact-tickets/:id` 🔒 |
| Orders | `POST /orders` (any signed-in user), `GET /orders` 🔒, `GET /orders/:id` 🔒, `PATCH /orders/:id/status` 🔒, `DELETE /orders/:id` 🔒 |
| Promotions | `GET /promotions/code/:code` (public), `GET /promotions` 🔒, `GET /promotions/:id` 🔒, `POST /promotions` 🔒, `PUT /promotions/:id` 🔒, `DELETE /promotions/:id` 🔒 |
| Finance | `GET /finance/transactions` 🔒, `GET /finance/summary` 🔒, `POST /finance/transactions` 🔒, `DELETE /finance/transactions/:id` 🔒 |
| Uploads | `POST /uploads/image` 🔒 (multipart field `file`, ≤5MB, image only), `POST /uploads/contact-image` (public, rate-limited), `DELETE /uploads/image/:publicId` 🔒 |

🔒 = requires `ADMIN` session (cookie or `Authorization: Bearer <token>`).

List endpoints (`GET /products`, `/customers`, `/orders`, `/promotions`, `/finance/transactions`)
accept `?page=&pageSize=` (default `pageSize=20`, capped at 100) and respond
`{ items, pagination: { page, pageSize, total, totalPages } }`.

## Data integrity notes

- **Order totals are recomputed server-side** from `items` on every `POST /orders` — the client
  can't under-charge or skew reported revenue by tampering with `subtotal`/`total` in the request.
- Creating an order also writes a matching `FinanceTransaction` (`status: "completed"` only when
  `paymentStatus: "paid"`), so `/finance/summary` always reflects real orders, not just manual
  entries.
- **Image uploads go through Cloudinary** — `POST /uploads/image` (admin, multipart `file`) streams
  straight to Cloudinary and returns `{ url, publicId }`; save `url` onto the product's
  `images`/`heroImage` fields (still plain strings — no local file storage). Requires
  `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET`; missing any of the
  three returns `503`, same pattern as the DB guard.
- Mongo/Mongoose errors (duplicate key, cast, validation) are translated into clean `400`/`409`
  JSON responses by the global error handler instead of leaking raw driver errors.
- **Product variants** (`Product.variants`, up to 100 per product) each carry their own `price` and
  `stockCount`, independent of the product's own `price`/`stockCount` — those stay the "base"
  values used for catalog sort/filter/cards; variants only affect the detail page's picker.

## Scripts

```bash
npm run dev              # tsx watch — auto-restart on change
npm run build              # tsc -> dist/
npm run start                # node dist/index.js (run build first)
npm run seed                  # wipe + reseed mock data (needs MONGODB_URI)
npm run smoke                   # full CRUD smoke test against an in-memory Mongo (no Atlas needed)
```
#   B a c k e n d - z e n o s t h o b b y s t o r e  
 #   z e n o s t h o b b y s t o r e  
 
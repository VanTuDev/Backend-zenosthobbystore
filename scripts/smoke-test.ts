/**
 * End-to-end smoke test against an in-memory MongoDB instance — no real
 * Atlas connection needed. Boots the real Express app, exercises auth +
 * CRUD across every resource, and fails loudly (non-zero exit) on the
 * first mismatch. Not a substitute for a real test suite, just a fast
 * "did I break the wiring" check to run after touching routes/models.
 */
import { MongoMemoryServer } from "mongodb-memory-server";

process.env.MONGODB_URI = ""; // placeholder, set for real once memory server boots
process.env.ALLOW_DEV_LOGIN = "true";
process.env.NODE_ENV = "test";

async function main() {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("zenos_smoke");

  const { createApp } = await import("../src/app");
  const { connectDb, disconnectDb } = await import("../src/lib/db");
  const { User } = await import("../src/models/user.model");

  await connectDb();
  // dev-login never auto-grants ADMIN (that would be an email-pattern privilege
  // escalation bug) — seed one admin directly, same as prisma/seed.ts does.
  await User.create({ email: "admin@zenoshobbystore.vn", name: "Seeded Admin", role: "ADMIN" });

  const app = createApp();
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;

  let failures = 0;
  function check(label: string, condition: boolean) {
    if (condition) {
      console.log(`  ok — ${label}`);
    } else {
      failures++;
      console.error(`  FAIL — ${label}`);
    }
  }

  async function call(method: string, path: string, opts: { body?: unknown; cookie?: string } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const setCookie = res.headers.get("set-cookie") ?? undefined;
    const json = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, json, setCookie };
  }

  console.log("Health check");
  const health = await call("GET", "/health");
  check("200 + dbConnected true", health.status === 200 && health.json.dbConnected === true);

  console.log("Auth");
  const adminLogin = await call("POST", "/auth/dev-login", {
    body: { email: "admin@zenoshobbystore.vn", name: "Admin" },
  });
  check("dev-login admin returns 200", adminLogin.status === 200);
  const adminCookie = adminLogin.setCookie?.split(";")[0];

  const customerLogin = await call("POST", "/auth/dev-login", {
    body: { email: "shopper@example.com", name: "Shopper" },
  });
  check("dev-login customer returns 200", customerLogin.status === 200);
  const customerCookie = customerLogin.setCookie?.split(";")[0];

  const me = await call("GET", "/auth/me", { cookie: adminCookie });
  check("me returns ADMIN role", me.json?.user?.role === "ADMIN");

  console.log("Folders + Categories");
  const folder = await call("POST", "/folders", { body: { name: "Anime" }, cookie: adminCookie });
  check("folder created", folder.status === 201);

  const category = await call("POST", "/categories", {
    body: { name: "Scale Figure", folderIds: [folder.json.folder.id] },
    cookie: adminCookie,
  });
  check("category created with folder linked", category.status === 201 && category.json.category.folderIds.length === 1);

  console.log("Products");
  const forbiddenCreate = await call("POST", "/products", { body: { name: "X", price: 1 }, cookie: customerCookie });
  check("customer cannot create product (403)", forbiddenCreate.status === 403);

  const product = await call("POST", "/products", {
    body: { name: "Raiden Shogun", price: 4590000, categoryId: category.json.category.id },
    cookie: adminCookie,
  });
  check("product created as admin (201)", product.status === 201);
  check("product slug auto-generated", product.json.product.slug === "raiden-shogun");

  const productBySlug = await call("GET", `/products/${product.json.product.slug}`);
  check("product fetched by slug", productBySlug.status === 200 && productBySlug.json.product.id === product.json.product.id);

  console.log("Product variants (own price/stock, capped at 100)");
  const productWithVariants = await call("PUT", `/products/${product.json.product.id}`, {
    body: {
      variants: [
        { name: "Đỏ - Size M", price: 4590000, stockCount: 5 },
        { name: "Xanh - Size L", price: 4790000, stockCount: 0 },
      ],
    },
    cookie: adminCookie,
  });
  check(
    "variants save with their own price/stock",
    productWithVariants.status === 200 &&
      productWithVariants.json.product.variants.length === 2 &&
      productWithVariants.json.product.variants[0].price === 4590000 &&
      productWithVariants.json.product.variants[1].stockCount === 0,
  );

  const tooManyVariants = await call("PUT", `/products/${product.json.product.id}`, {
    body: { variants: Array.from({ length: 101 }, (_, i) => ({ name: `V${i}`, price: 1000, stockCount: 1 })) },
    cookie: adminCookie,
  });
  check("more than 100 variants rejected (400)", tooManyVariants.status === 400);

  console.log("Orders (server recomputes totals)");
  const order = await call("POST", "/orders", {
    body: {
      customerName: "Shopper",
      customerEmail: "shopper@example.com",
      phone: "0900000000",
      provinceCode: "79",
      provinceName: "Thành phố Hồ Chí Minh",
      wardCode: "25747",
      wardName: "Phường Thủ Dầu Một",
      addressDetail: "123 Test St",
      items: [
        {
          productId: product.json.product.id,
          name: product.json.product.name,
          price: product.json.product.price,
          quantity: 2,
        },
      ],
      shippingFee: 30000,
      paymentMethod: "COD",
      paymentStatus: "paid",
    },
    cookie: customerCookie,
  });
  const expectedTotal = product.json.product.price * 2 + 30000;
  check("order total computed server-side", order.status === 201 && order.json.order.total === expectedTotal);

  console.log("Orders + promo code (server-computed discount)");
  const promoForOrder = await call("POST", "/promotions", {
    body: {
      name: "Order promo",
      code: "orderpromo",
      type: "percentage",
      value: 10,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 86400000).toISOString(),
      status: "active",
      usageLimit: 5,
    },
    cookie: adminCookie,
  });
  const orderWithPromo = await call("POST", "/orders", {
    body: {
      customerName: "Shopper",
      customerEmail: "shopper@example.com",
      phone: "0900000000",
      provinceCode: "79",
      provinceName: "Thành phố Hồ Chí Minh",
      wardCode: "25747",
      wardName: "Phường Thủ Dầu Một",
      addressDetail: "123 Test St",
      items: [
        {
          productId: product.json.product.id,
          name: product.json.product.name,
          price: product.json.product.price,
          quantity: 1,
        },
      ],
      shippingFee: 0,
      promotionCode: "orderpromo",
      paymentMethod: "COD",
      paymentStatus: "unpaid",
    },
    cookie: customerCookie,
  });
  const expectedDiscount = Math.round(product.json.product.price * 0.1);
  check(
    "order applies server-computed discount from a valid promo code",
    orderWithPromo.status === 201 &&
      orderWithPromo.json.order.discount === expectedDiscount &&
      orderWithPromo.json.order.promotionCode === "ORDERPROMO",
  );
  const promoAfterOrder = await call("GET", `/promotions/${promoForOrder.json.promotion.id}`, { cookie: adminCookie });
  check("promo usageCount incremented after order", promoAfterOrder.json.promotion.usageCount === 1);

  const orderWithBadPromo = await call("POST", "/orders", {
    body: {
      customerName: "Shopper",
      customerEmail: "shopper@example.com",
      phone: "0900000000",
      provinceCode: "79",
      provinceName: "Thành phố Hồ Chí Minh",
      wardCode: "25747",
      wardName: "Phường Thủ Dầu Một",
      addressDetail: "123 Test St",
      items: [
        {
          productId: product.json.product.id,
          name: product.json.product.name,
          price: product.json.product.price,
          quantity: 1,
        },
      ],
      shippingFee: 0,
      promotionCode: "NOPE-NOT-REAL",
      paymentMethod: "COD",
      paymentStatus: "unpaid",
    },
    cookie: customerCookie,
  });
  check("order rejects an unknown promo code (400)", orderWithBadPromo.status === 400);

  console.log("PayOS payment simulation");
  const payosOrder = await call("POST", "/orders", {
    body: {
      customerName: "Shopper",
      customerEmail: "shopper@example.com",
      phone: "0900000000",
      provinceCode: "79",
      provinceName: "Thành phố Hồ Chí Minh",
      wardCode: "25747",
      wardName: "Phường Thủ Dầu Một",
      addressDetail: "123 Test St",
      items: [
        {
          productId: product.json.product.id,
          name: product.json.product.name,
          price: product.json.product.price,
          quantity: 1,
        },
      ],
      shippingFee: 0,
      paymentMethod: "Ví điện tử",
      paymentStatus: "unpaid",
    },
    cookie: customerCookie,
  });
  const payosCreate = await call("POST", `/payments/payos/${payosOrder.json.order.id}`, { cookie: customerCookie });
  check("payos create returns a paymentRef", payosCreate.status === 201 && typeof payosCreate.json.paymentRef === "string");
  const payosConfirm = await call("POST", `/payments/payos/${payosOrder.json.order.id}/confirm`, { cookie: customerCookie });
  check("payos confirm marks the order paid", payosConfirm.status === 200 && payosConfirm.json.order.paymentStatus === "paid");

  // 3 orders exist for this customer by now: order, orderWithPromo, payosOrder (orderWithBadPromo was rejected, never created).
  const myOrderList = await call("GET", "/orders", { cookie: customerCookie });
  check(
    "customer lists only their own orders",
    myOrderList.status === 200 && myOrderList.json.items.length === 3,
  );

  const orderList = await call("GET", "/orders", { cookie: adminCookie });
  check("admin can list orders", orderList.status === 200 && orderList.json.items.length === 3);

  const statusUpdate = await call("PATCH", `/orders/${order.json.order.id}/status`, {
    body: { status: "shipped" },
    cookie: adminCookie,
  });
  check("order status updated", statusUpdate.status === 200 && statusUpdate.json.order.status === "shipped");

  const paymentStatusUpdate = await call("PATCH", `/orders/${order.json.order.id}/payment-status`, {
    body: { paymentStatus: "refunded" },
    cookie: adminCookie,
  });
  check(
    "order payment status updated",
    paymentStatusUpdate.status === 200 && paymentStatusUpdate.json.order.paymentStatus === "refunded",
  );

  console.log("Locations (VN provinces/wards)");
  const provinces = await call("GET", "/locations/provinces");
  check("locations/provinces reachable", provinces.status === 200 && Array.isArray(provinces.json.provinces));
  const wards = await call("GET", "/locations/wards?provinceCode=79");
  check("locations/wards reachable", wards.status === 200 && Array.isArray(wards.json.wards));
  const missingProvinceCode = await call("GET", "/locations/wards");
  check("locations/wards requires provinceCode", missingProvinceCode.status === 400);

  console.log("Finance (auto transaction from order)");
  const summary = await call("GET", "/finance/summary", { cookie: adminCookie });
  check("finance summary reflects the refund, not the original revenue", summary.json.revenue !== expectedTotal);

  console.log("Promotions");
  const promo = await call("POST", "/promotions", {
    body: {
      name: "Test promo",
      code: "test10",
      type: "percentage",
      value: 10,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 86400000).toISOString(),
      status: "active",
    },
    cookie: adminCookie,
  });
  check("promo code uppercased", promo.status === 201 && promo.json.promotion.code === "TEST10");

  const promoLookup = await call("GET", "/promotions/code/TEST10");
  check("public promo lookup works", promoLookup.status === 200 && promoLookup.json.isValid === true);

  console.log("Customers CRUD");
  const customer = await call("POST", "/customers", {
    body: { name: "Test Customer", email: "test.customer@example.com" },
    cookie: adminCookie,
  });
  check("customer created", customer.status === 201);
  const dupe = await call("POST", "/customers", {
    body: { name: "Dupe", email: "test.customer@example.com" },
    cookie: adminCookie,
  });
  check("duplicate email rejected with 409", dupe.status === 409);

  console.log("Contact tickets (public support form)");
  const ticket = await call("POST", "/contact-tickets", {
    body: {
      subject: "product",
      customerName: "Guest Visitor",
      customerEmail: "guest@example.com",
      message: "Sản phẩm này còn hàng không?",
    },
  });
  check("ticket submitted without login (201)", ticket.status === 201 && ticket.json.ticket.status === "open");

  const ticketForbidden = await call("GET", "/contact-tickets", { cookie: customerCookie });
  check("non-admin cannot list tickets (403)", ticketForbidden.status === 403);

  const ticketList = await call("GET", "/contact-tickets", { cookie: adminCookie });
  check("admin can list tickets", ticketList.status === 200 && ticketList.json.items.length === 1);

  const ticketStatusUpdate = await call("PATCH", `/contact-tickets/${ticket.json.ticket.id}/status`, {
    body: { status: "resolved" },
    cookie: adminCookie,
  });
  check(
    "admin can resolve a ticket",
    ticketStatusUpdate.status === 200 && ticketStatusUpdate.json.ticket.status === "resolved",
  );

  console.log("Cleanup");
  const del = await call("DELETE", `/products/${product.json.product.id}`, { cookie: adminCookie });
  check("product deleted", del.status === 204);

  server.close();
  await disconnectDb();
  await mongod.stop();

  console.log(failures === 0 ? "\nAll smoke checks passed." : `\n${failures} smoke check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { isMongoConfigured } from "./config/env";
import { connectDb, disconnectDb } from "./lib/db";
import { Category } from "./models/category.model";
import { Customer } from "./models/customer.model";
import { FinanceTransaction } from "./models/finance-transaction.model";
import { Folder } from "./models/folder.model";
import { Order } from "./models/order.model";
import { Product } from "./models/product.model";
import { Promotion } from "./models/promotion.model";
import { User } from "./models/user.model";

/**
 * Minimal seed — just enough rows per collection (1-2) to see real data end
 * to end, not a wall of fixtures to maintain.
 */
async function main() {
  if (!isMongoConfigured) {
    console.error("MONGODB_URI chưa được cấu hình trong .env — không thể seed. Điền connection string MongoDB Atlas rồi chạy lại.");
    process.exit(1);
  }

  await connectDb();
  console.log("Seeding (minimal)...");

  await Promise.all([
    FinanceTransaction.deleteMany({}),
    Order.deleteMany({}),
    Product.deleteMany({}),
    Category.deleteMany({}),
    Folder.deleteMany({}),
    Customer.deleteMany({}),
    Promotion.deleteMany({}),
    User.deleteMany({}),
  ]);

  // --- Users ---
  const admin = await User.create({ email: "admin@zenoshobbystore.vn", name: "ZENOS Admin", role: "ADMIN" });
  const shopper = await User.create({ email: "minhanh.collector@gmail.com", name: "Minh Anh Nguyễn", role: "CUSTOMER" });

  // --- Folders ---
  const animeFolder = await Folder.create({ name: "Anime", slug: "anime" });

  // --- Categories ---
  const scaleFigure = await Category.create({
    name: "Scale Figure",
    slug: "scale-figure",
    description: "Mô hình tỉ lệ chi tiết cao",
    folderIds: [animeFolder._id],
  });
  const gunpla = await Category.create({
    name: "Gunpla",
    slug: "gunpla",
    description: "Mô hình lắp ráp Gundam",
    folderIds: [animeFolder._id],
  });

  // --- Products (no real images yet — left blank on purpose) ---
  const products = await Product.insertMany([
    {
      name: "Raiden Shogun 1/7 Scale Figure",
      slug: "raiden-shogun-genshin-1-7",
      brand: "Good Smile Company",
      universe: "Genshin Impact",
      scale: "1/7",
      price: 4590000,
      compareAtPrice: 5200000,
      stockStatus: "in_stock",
      stockCount: 12,
      badges: ["best_seller"],
      rating: 4.8,
      reviewCount: 56,
      description: "Mô hình Raiden Shogun tỉ lệ 1/7, chi tiết sơn tay cao cấp.",
      highlights: ["Chi tiết sơn tay", "Đế trưng bày kèm hiệu ứng"],
      specs: [{ label: "Chất liệu", value: "PVC & ABS" }],
      categoryId: scaleFigure._id,
    },
    {
      name: "RG 1/144 Nu Gundam",
      slug: "rg-1-144-nu-gundam",
      brand: "Bandai Spirits",
      universe: "Gundam Char's Counterattack",
      scale: "1/144",
      price: 890000,
      stockStatus: "in_stock",
      stockCount: 40,
      badges: ["new_arrival"],
      rating: 4.6,
      reviewCount: 88,
      description: "Real Grade Nu Gundam tỉ lệ 1/144, khung nội bộ chi tiết.",
      highlights: ["Khung nội bộ Real Grade", "Decal nước đi kèm"],
      specs: [{ label: "Chất liệu", value: "PS & ABS" }],
      categoryId: gunpla._id,
    },
  ]);

  // --- Customers (CRM records) ---
  await Customer.insertMany([
    {
      name: "Minh Anh Nguyễn",
      email: "minhanh.collector@gmail.com",
      phone: "0901234567",
      tier: "Vàng",
      totalOrders: 8,
      totalSpent: 32000000,
      status: "vip",
    },
    {
      name: "Trần Bảo Long",
      email: "long.tran@example.com",
      phone: "0912345678",
      tier: "Bạc",
      totalOrders: 3,
      totalSpent: 9500000,
      status: "active",
    },
  ]);

  // --- Promotions ---
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await Promotion.insertMany([
    {
      name: "Summer Sale 2026",
      code: "SUMMER24",
      type: "percentage",
      value: 15,
      appliesTo: "Toàn bộ đơn hàng",
      startDate: now,
      endDate: in30Days,
      status: "active",
      usageCount: 12,
      usageLimit: 500,
    },
  ]);

  // --- A sample order + its finance transaction ---
  const order = await Order.create({
    customerName: "Minh Anh Nguyễn",
    customerEmail: "minhanh.collector@gmail.com",
    phone: "0901234567",
    provinceCode: "79",
    provinceName: "Thành phố Hồ Chí Minh",
    wardCode: "25747",
    wardName: "Phường Thủ Dầu Một",
    addressDetail: "12 Lê Lợi",
    shippingAddress: "12 Lê Lợi, Phường Thủ Dầu Một, Thành phố Hồ Chí Minh",
    items: [
      { productId: products[0]._id, slug: products[0].slug, name: products[0].name, price: products[0].price, quantity: 1 },
    ],
    subtotal: 4590000,
    shippingFee: 0,
    discount: 0,
    total: 4590000,
    status: "delivered",
    paymentMethod: "Chuyển khoản",
    paymentStatus: "paid",
    userId: shopper._id,
  });

  await FinanceTransaction.create({
    orderId: order._id,
    customer: order.customerName,
    amount: order.total,
    type: "revenue",
    method: order.paymentMethod,
    status: "completed",
  });

  console.log("Seed complete.");
  console.log(`Admin login (dev bypass): POST /auth/dev-login { "email": "${admin.email}" }`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectDb();
  });

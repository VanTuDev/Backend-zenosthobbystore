import { isMongoConfigured } from "../src/config/env";
import { connectDb, disconnectDb } from "../src/lib/db";
import { Category } from "../src/models/category.model";
import { Folder } from "../src/models/folder.model";
import { Product } from "../src/models/product.model";
import { slugify } from "../src/utils/slugify";

/**
 * Additive demo-catalog seed: 5 top-level categories x 3 sub-categories (20 total)
 * plus 100 products (20 per theme), so the storefront/admin can be reviewed with a
 * realistic amount of data. Purely additive — upserts categories/folders by slug and
 * only inserts products whose slug doesn't already exist, so it never touches Users,
 * Orders, Customers, Promotions or FinanceTransactions, and is safe to re-run.
 */

type ChildSpec = {
  name: string;
  slug: string;
  description: string;
  brand: string;
  lineLabel: string;
  scalePool?: string[];
  /** Characters that belong on this product line — explicit per child so franchises never mix (e.g. Transformers never lands under Gunpla). */
  characters: string[];
};

type ThemeSpec = {
  parentName: string;
  parentSlug: string;
  parentDescription: string;
  folderName: string;
  folderSlug: string;
  universe: string;
  basePrice: number;
  children: ChildSpec[];
};

const THEMES: ThemeSpec[] = [
  {
    parentName: "Mô hình Pokémon",
    parentSlug: "mo-hinh-pokemon",
    parentDescription: "Mô hình các Pokémon quen thuộc, từ scale figure chi tiết cao đến prize figure và nendoroid.",
    folderName: "Pokémon",
    folderSlug: "pokemon",
    universe: "Pokémon",
    basePrice: 650000,
    children: [
      {
        name: "Pokémon Scale Figure", slug: "pokemon-scale-figure", description: "Scale figure chi tiết cao các Pokémon.",
        brand: "Kotobukiya", lineLabel: "Scale Figure", scalePool: ["1/8", "1/7", "1/6"],
        characters: ["Pikachu", "Charizard", "Mewtwo", "Gengar", "Lucario", "Rayquaza", "Dragonite"],
      },
      {
        name: "Pokémon Prize Figure", slug: "pokemon-prize-figure", description: "Prize figure Pokémon phong cách năng động.",
        brand: "Banpresto", lineLabel: "Prize Figure",
        characters: ["Greninja", "Gyarados", "Snorlax", "Blastoise", "Venusaur", "Garchomp", "Absol"],
      },
      {
        name: "Pokémon Nendoroid", slug: "pokemon-nendoroid", description: "Nendoroid Pokémon dễ thương, khớp nối linh hoạt.",
        brand: "Good Smile Company", lineLabel: "Nendoroid",
        characters: ["Eevee", "Umbreon", "Sylveon", "Mimikyu", "Zeraora", "Glaceon"],
      },
    ],
  },
  {
    parentName: "Mô hình Siêu Nhân",
    parentSlug: "mo-hinh-sieu-nhan",
    parentDescription: "Mô hình action figure các chiến binh Tokusatsu: Kamen Rider, Ultraman, Super Sentai.",
    folderName: "Tokusatsu",
    folderSlug: "tokusatsu",
    universe: "Tokusatsu",
    basePrice: 850000,
    children: [
      {
        name: "Kamen Rider", slug: "kamen-rider", description: "S.H.Figuarts các Kamen Rider qua nhiều thế hệ.",
        brand: "Bandai Spirits", lineLabel: "S.H.Figuarts",
        characters: [
          "Kamen Rider Zero-One", "Kamen Rider Black Sun", "Kamen Rider Geats", "Kamen Rider Revice",
          "Kamen Rider Kuuga", "Kamen Rider Geiz", "Kamen Rider Vulcan", "Kamen Rider Saber", "Kamen Rider Gotchard",
        ],
      },
      {
        name: "Ultraman", slug: "ultraman", description: "S.H.Figuarts dòng Ultraman biến hình chi tiết.",
        brand: "Bandai Spirits", lineLabel: "S.H.Figuarts",
        characters: ["Ultraman Zeta", "Ultraman Decker", "Ultraman Trigger", "Ultraman Tiga", "Ultraman Zero", "Ultraman Blazar"],
      },
      {
        name: "Super Sentai", slug: "super-sentai", description: "Action figure các đội Super Sentai.",
        brand: "Bandai Spirits", lineLabel: "S.H.Figuarts",
        characters: [
          "Kishiryu Sentai Ryusoulger", "Kikai Sentai Zenkaiger", "Mashin Sentai Kiramager",
          "Avataro Sentai Donbrothers", "Ohsama Sentai King-Ohger",
        ],
      },
    ],
  },
  {
    parentName: "Mô hình Dragon Ball",
    parentSlug: "mo-hinh-dragon-ball",
    parentDescription: "Mô hình các nhân vật Dragon Ball: Figuarts, Ichiban Kuji, scale figure.",
    folderName: "Anime",
    folderSlug: "anime",
    universe: "Dragon Ball",
    basePrice: 950000,
    children: [
      {
        name: "Dragon Ball Figuarts", slug: "dragon-ball-figuarts", description: "S.H.Figuarts các chiến binh Dragon Ball.",
        brand: "Bandai Spirits", lineLabel: "S.H.Figuarts",
        characters: [
          "Son Goku Ultra Instinct", "Vegeta Super Saiyan Blue", "Son Goku Super Saiyan", "Frieza Final Form",
          "Gohan Super Saiyan 2", "Piccolo", "Trunks Super Saiyan",
        ],
      },
      {
        name: "Dragon Ball Ichiban Kuji", slug: "dragon-ball-ichiban-kuji", description: "Figure trúng thưởng Ichiban Kuji Dragon Ball.",
        brand: "Bandai Spirits", lineLabel: "Ichiban Kuji Figure",
        characters: ["Cell Perfect Form", "Majin Buu", "Broly Legendary Super Saiyan", "Beerus", "Whis", "Zeno", "Android 17"],
      },
      {
        name: "Dragon Ball Scale Figure", slug: "dragon-ball-scale-figure", description: "Scale figure Dragon Ball chi tiết cao.",
        brand: "MegaHouse", lineLabel: "Scale Figure", scalePool: ["1/8", "1/6", "1/4"],
        characters: ["Vegito Blue", "Gogeta Super Saiyan 4", "Android 18", "Master Roshi", "Bulma", "Krillin"],
      },
    ],
  },
  {
    parentName: "Mô hình Naruto",
    parentSlug: "mo-hinh-naruto",
    parentDescription: "Mô hình các nhân vật Naruto & Boruto: Figuarts, scale figure, nendoroid.",
    folderName: "Anime",
    folderSlug: "anime",
    universe: "Naruto",
    basePrice: 780000,
    children: [
      {
        name: "Naruto Figuarts", slug: "naruto-figuarts", description: "S.H.Figuarts các ninja làng lá.",
        brand: "Bandai Spirits", lineLabel: "S.H.Figuarts",
        characters: ["Naruto Uzumaki Sage Mode", "Sasuke Uchiha Susanoo", "Kakashi Hatake", "Itachi Uchiha", "Gaara", "Madara Uchiha", "Obito Uchiha"],
      },
      {
        name: "Naruto Scale Figure", slug: "naruto-scale-figure", description: "Scale figure Naruto chi tiết cao.",
        brand: "MegaHouse", lineLabel: "Scale Figure", scalePool: ["1/8", "1/7", "1/6"],
        characters: ["Sakura Haruno", "Jiraiya", "Minato Namikaze", "Pain Nagato", "Might Guy", "Orochimaru", "Kurama Nine-Tails"],
      },
      {
        name: "Naruto Nendoroid", slug: "naruto-nendoroid", description: "Nendoroid các ninja Naruto phiên bản dễ thương.",
        brand: "Good Smile Company", lineLabel: "Nendoroid",
        characters: ["Rock Lee", "Hinata Hyuga", "Shikamaru Nara", "Tsunade", "Boruto Uzumaki", "Sasori"],
      },
    ],
  },
  {
    parentName: "Mô hình Robot",
    parentSlug: "mo-hinh-robot",
    parentDescription: "Mô hình robot lắp ráp và action figure: Gunpla, Transformers, mecha các dòng khác.",
    folderName: "Robot & Mecha",
    folderSlug: "robot-mecha",
    universe: "Mecha",
    basePrice: 780000,
    children: [
      {
        name: "Gunpla", slug: "gunpla", description: "Mô hình lắp ráp Gundam các dòng HG/RG/MG/PG.",
        brand: "Bandai Spirits", lineLabel: "Gunpla", scalePool: ["1/144", "1/144", "1/100", "1/60"],
        characters: [
          "RX-78-2 Gundam", "Strike Freedom Gundam", "Unicorn Gundam", "Wing Gundam Zero", "Sazabi",
          "Barbatos Lupus", "Nu Gundam", "Zaku II",
        ],
      },
      {
        name: "Transformers", slug: "transformers", description: "Robot biến hình dòng Transformers.",
        brand: "Hasbro", lineLabel: "Studio Series",
        characters: ["Optimus Prime", "Bumblebee", "Megatron", "Starscream", "Soundwave", "Grimlock", "Jetfire", "Ironhide"],
      },
      {
        name: "Mecha Robot Khác", slug: "mecha-robot-khac", description: "Mecha robot từ các thương hiệu khác ngoài Gundam/Transformers.",
        brand: "Kotobukiya", lineLabel: "Riobot",
        characters: ["EVA Unit-01", "EVA Unit-02", "Getter Robo", "Mazinger Z"],
      },
    ],
  },
];

const STOCK_STATUSES = ["in_stock", "in_stock", "in_stock", "in_stock", "in_stock", "in_stock", "in_stock", "pre_order", "pre_order", "sold_out", "coming_soon"] as const;
const BADGE_POOL = ["new_arrival", "best_seller", "limited", "exclusive"] as const;

function pick<T>(pool: readonly T[], i: number): T {
  return pool[i % pool.length];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

async function main() {
  if (!isMongoConfigured) {
    console.error("MONGODB_URI chưa được cấu hình trong .env — không thể seed.");
    process.exit(1);
  }

  await connectDb();
  console.log("Seeding demo catalog (additive)...");

  const folderIdBySlug = new Map<string, string>();
  const uniqueFolders = new Map(THEMES.map((t) => [t.folderSlug, t.folderName]));
  for (const [slug, name] of uniqueFolders) {
    const folder = await Folder.findOneAndUpdate(
      { slug },
      { $setOnInsert: { name, slug } },
      { upsert: true, new: true },
    );
    folderIdBySlug.set(slug, folder.id);
  }

  let categoriesCreated = 0;
  let productsCreated = 0;

  for (const theme of THEMES) {
    const parent = await Category.findOneAndUpdate(
      { slug: theme.parentSlug },
      {
        $setOnInsert: {
          name: theme.parentName,
          slug: theme.parentSlug,
          description: theme.parentDescription,
          folderIds: [folderIdBySlug.get(theme.folderSlug)],
        },
      },
      { upsert: true, new: true },
    );
    if (parent.createdAt.getTime() === parent.updatedAt.getTime()) categoriesCreated++;

    let productIndex = 0;
    for (const child of theme.children) {
      const category = await Category.findOneAndUpdate(
        { slug: child.slug },
        {
          $setOnInsert: {
            name: child.name,
            slug: child.slug,
            description: child.description,
            parentId: parent._id,
            folderIds: [folderIdBySlug.get(theme.folderSlug)],
          },
        },
        { upsert: true, new: true },
      );
      if (category.createdAt.getTime() === category.updatedAt.getTime()) categoriesCreated++;

      for (const character of child.characters) {
        const i = productIndex++;
        const scale = child.scalePool ? pick(child.scalePool, i) : "";
        const name = `${character} ${child.lineLabel}${scale ? ` ${scale}` : ""}`;
        const slug = slugify(name);

        const existing = await Product.findOne({ slug }).select("_id");
        if (existing) continue;

        const priceVariance = 1 + ((i * 37) % 400) / 100; // ~1.0x - ~5.0x spread across the theme
        const price = Math.round((theme.basePrice * priceVariance) / 10000) * 10000;
        const stockStatus = pick(STOCK_STATUSES, i * 3 + theme.parentSlug.length);
        const badges: string[] = [];
        if (i % 6 === 0) badges.push("new_arrival");
        if (i % 9 === 0) badges.push("best_seller");
        if (i % 11 === 0) badges.push("limited");
        if (i % 13 === 0) badges.push("exclusive");
        if (stockStatus === "sold_out" && !badges.includes("sold_out")) badges.push("sold_out");

        await Product.create({
          name,
          slug,
          brand: child.brand,
          universe: theme.universe,
          scale,
          price,
          compareAtPrice: i % 5 === 0 ? Math.round((price * 1.15) / 10000) * 10000 : null,
          stockStatus,
          stockCount: stockStatus === "sold_out" ? 0 : 3 + (i % 25),
          badges,
          rating: round1(Math.min(5, 3.6 + ((i * 13) % 15) / 10)),
          reviewCount: 8 + ((i * 17) % 180),
          description: `${name} — mô hình chính hãng ${child.brand}, thuộc dòng ${child.lineLabel} lấy cảm hứng từ ${theme.universe}.`,
          highlights: [`Chính hãng ${child.brand}`, `Chất liệu PVC & ABS cao cấp`, `Đóng gói chống sốc khi giao hàng`],
          specs: [
            { label: "Chất liệu", value: "PVC & ABS" },
            { label: "Xuất xứ", value: "Nhật Bản" },
            ...(scale ? [{ label: "Tỉ lệ", value: scale }] : []),
          ],
          categoryId: category.id,
        });
        productsCreated++;
      }
    }
  }

  console.log(`Seed demo catalog complete. Danh mục mới: ${categoriesCreated}, sản phẩm mới: ${productsCreated}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await disconnectDb();
  });

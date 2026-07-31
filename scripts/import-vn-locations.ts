/**
 * One-time import of Vietnam's post-2025 2-level administrative data
 * (province -> ward directly, no district) from the Postgres dump the repo
 * owner provided at the repo root. There's no Postgres driver in this
 * stack, so this is a small text-parser, not a real SQL execution — see
 * `parseInsertRows` for the quote-aware tuple scanner (a naive
 * `.split(",")` would corrupt names like "Ea H'Leo" that use SQL's
 * doubled-quote escaping, e.g. `'Ea H''Leo'`).
 *
 * Run once (or whenever the source SQL file changes) via `npm run import:vn-locations`.
 * Deliberately kept out of `seed.ts` — this is static government reference
 * data, not demo data that should be wiped on every routine reseed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isMongoConfigured } from "../src/config/env";
import { connectDb, disconnectDb } from "../src/lib/db";
import { Province } from "../src/models/province.model";
import { Ward } from "../src/models/ward.model";

const SQL_FILE_PATH = resolve(__dirname, "../../postgres_ImportData_vn_units.sql");

/** Parses `('a','b',...), ('c','d',...), ...` into arrays of raw field strings, per row. */
function parseInsertRows(valuesBlock: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  const len = valuesBlock.length;

  while (i < len) {
    while (i < len && valuesBlock[i] !== "(") i++;
    if (i >= len) break;
    i++; // consume '('

    const fields: string[] = [];
    let current = "";
    let inString = false;

    while (i < len) {
      const ch = valuesBlock[i];

      if (inString) {
        if (ch === "'") {
          if (valuesBlock[i + 1] === "'") {
            current += "'"; // escaped quote inside a literal
            i += 2;
            continue;
          }
          inString = false;
          i++;
          continue;
        }
        current += ch;
        i++;
        continue;
      }

      if (ch === "'") {
        inString = true;
        i++;
        continue;
      }
      if (ch === ",") {
        fields.push(current.trim());
        current = "";
        i++;
        continue;
      }
      if (ch === ")") {
        fields.push(current.trim());
        i++;
        break;
      }
      current += ch;
      i++;
    }

    rows.push(fields);
  }

  return rows;
}

function extractValueBlocks(sql: string, tableName: string): string[] {
  const pattern = new RegExp(`INSERT INTO ${tableName}\\([^)]*\\)\\s*VALUES\\s*([\\s\\S]*?);`, "g");
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

async function main() {
  if (!isMongoConfigured) {
    console.error("MONGODB_URI chưa được cấu hình trong .env — không thể import.");
    process.exit(1);
  }

  const sql = readFileSync(SQL_FILE_PATH, "utf-8");

  // provinces(code,name,name_en,full_name,full_name_en,code_name,administrative_unit_id)
  const provinceRows = extractValueBlocks(sql, "provinces").flatMap(parseInsertRows);
  const provinces = provinceRows.map(([code, name, , fullName, , codeName]) => ({
    code,
    name,
    fullName,
    codeName,
  }));

  // wards(code,name,name_en,full_name,full_name_en,code_name,province_code,administrative_unit_id)
  const wardRows = extractValueBlocks(sql, "wards").flatMap(parseInsertRows);
  const wards = wardRows.map(([code, name, , fullName, , codeName, provinceCode]) => ({
    code,
    name,
    fullName,
    codeName,
    provinceCode,
  }));

  console.log(`Parsed ${provinces.length} provinces, ${wards.length} wards from ${SQL_FILE_PATH}`);

  await connectDb();

  await Province.deleteMany({});
  await Province.insertMany(provinces, { ordered: false });

  await Ward.deleteMany({});
  await Ward.insertMany(wards, { ordered: false });

  console.log(`Imported ${await Province.countDocuments()} provinces, ${await Ward.countDocuments()} wards.`);

  await disconnectDb();
}

main().catch((err) => {
  console.error("Import thất bại:", err);
  process.exit(1);
});

import { Router } from "express";
import { requireDb } from "../middleware/require-db";
import { Province } from "../models/province.model";
import { Ward } from "../models/ward.model";
import { ApiError } from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";
import { slugify } from "../utils/slugify";
import { getLegacyDistricts, getLegacyProvinces, getLegacyWards } from "../lib/legacy-locations";

/** Public, read-only Vietnam administrative data (post-2025 2-level reform: province -> ward). */
export const locationsRouter = Router();
locationsRouter.use(requireDb);

/** Caps how many rows the typeahead sends back per keystroke — the client only ever renders a short dropdown. */
const SEARCH_RESULT_LIMIT = 20;

/**
 * Accent-insensitive "contains" filter for the FE search-as-you-type combobox.
 * Runs in memory (not a Mongo regex) so it matches regardless of Vietnamese diacritics —
 * datasets here are small (34 provinces; at most a few hundred wards per province), so this is cheap.
 */
function filterByQuery<T extends { fullName: string }>(items: T[], q: string | undefined): T[] {
  const needle = q?.trim();
  if (!needle) return items.slice(0, SEARCH_RESULT_LIMIT);
  const slugNeedle = slugify(needle);
  return items.filter((item) => slugify(item.fullName).includes(slugNeedle)).slice(0, SEARCH_RESULT_LIMIT);
}

locationsRouter.get(
  "/provinces",
  asyncHandler(async (req, res) => {
    const { q } = req.query as Record<string, string | undefined>;
    const provinces = await Province.find().sort({ name: 1 });
    res.json({ provinces: filterByQuery(provinces, q) });
  }),
);

locationsRouter.get(
  "/legacy/provinces",
  asyncHandler(async (req, res) => {
    const { q } = req.query as Record<string, string | undefined>;
    const provinces = (await getLegacyProvinces()).map((item) => ({ code: String(item.code), name: item.name, fullName: item.name }));
    res.json({ provinces: filterByQuery(provinces, q) });
  }),
);

locationsRouter.get(
  "/legacy/districts",
  asyncHandler(async (req, res) => {
    const { provinceCode, q } = req.query as Record<string, string | undefined>;
    if (!provinceCode?.trim()) throw ApiError.badRequest("Thiếu tham số provinceCode.");
    const districts = (await getLegacyDistricts(provinceCode)).map((item) => ({ code: String(item.code), name: item.name, fullName: item.name }));
    res.json({ districts: filterByQuery(districts, q) });
  }),
);

locationsRouter.get(
  "/legacy/wards",
  asyncHandler(async (req, res) => {
    const { districtCode, q } = req.query as Record<string, string | undefined>;
    if (!districtCode?.trim()) throw ApiError.badRequest("Thiếu tham số districtCode.");
    const wards = (await getLegacyWards(districtCode)).map((item) => ({ code: String(item.code), name: item.name, fullName: item.name }));
    res.json({ wards: filterByQuery(wards, q) });
  }),
);

locationsRouter.get(
  "/wards",
  asyncHandler(async (req, res) => {
    const { provinceCode, q } = req.query as Record<string, string | undefined>;
    if (!provinceCode?.trim()) throw ApiError.badRequest("Thiếu tham số provinceCode.");

    const wards = await Ward.find({ provinceCode }).sort({ name: 1 });
    res.json({ wards: filterByQuery(wards, q) });
  }),
);

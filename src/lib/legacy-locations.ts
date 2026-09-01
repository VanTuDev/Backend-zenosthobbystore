const LEGACY_API_BASE = "https://provinces.open-api.vn/api/v1";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type LegacyLocation = { code: number; name: string };
type LegacyProvince = LegacyLocation & { districts?: LegacyDistrict[] };
type LegacyDistrict = LegacyLocation & { wards?: LegacyLocation[] };

const cache = new Map<string, { expiresAt: number; value: unknown }>();

async function fetchCached<T>(path: string): Promise<T> {
  const cached = cache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;

  const response = await fetch(`${LEGACY_API_BASE}${path}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Legacy location API returned ${response.status}.`);
  const value = (await response.json()) as T;
  cache.set(path, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

export async function getLegacyProvinces(): Promise<LegacyLocation[]> {
  return fetchCached<LegacyProvince[]>("/?depth=1");
}

export async function getLegacyDistricts(provinceCode: string): Promise<LegacyLocation[]> {
  const province = await fetchCached<LegacyProvince>(`/p/${encodeURIComponent(provinceCode)}?depth=2`);
  return province.districts ?? [];
}

export async function getLegacyWards(districtCode: string): Promise<LegacyLocation[]> {
  const district = await fetchCached<LegacyDistrict>(`/d/${encodeURIComponent(districtCode)}?depth=2`);
  return district.wards ?? [];
}

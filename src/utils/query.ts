/** Normalizes a query param that Express may parse as `undefined | string | string[]` into a string array. */
export function toArray(value: unknown): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

import { ExtractedFeatures, ExtractedFromInput, StockMasterRow } from "./types";

const productKeywords: Record<string, string[]> = {
  BORU: ["boru", "tube", "pipe"],
  PROFIL: ["profil", "profile"],
  LAMA: ["lama", "flat bar"],
  SAC: ["sac", "sheet", "levha"],
  KOSEBENT: ["kosebent", "köşebent", "angle"],
  MIL: ["mil", "rod", "bar"]
};

const SERIES_REGEX = /\b([1-9]\d{3})\b/g;
const TEMPER_REGEX = /\b(T\d{1,4})\b/gi;
const DIM_GROUP_REGEX = /(\d+(?:[\.,]\d+)?)\s*[x*]\s*(\d+(?:[\.,]\d+)?)(?:\s*[x*]\s*(\d+(?:[\.,]\d+)?))?/g;

export function normalizeText(input: string): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .replace(/[×]/g, "x")
    .replace(/\*/g, "x")
    .replace(/\b(\d+),(\d+)\b/g, "$1.$2")
    .replace(/\s+/g, " ")
    .trim();
}

function detectSeries(text: string): string | null {
  const matches = [...text.matchAll(SERIES_REGEX)];
  if (matches.length === 0) return null;
  return matches[0][1] ?? null;
}

/**
 * Boyut değerlerini (dim1, dim2, dim3) dışlayarak seri tespit eder.
 * Örnek: "1000x2000 5083" → dim seti {1000, 2000}, seri = 5083
 * Son bulunan alınır çünkü alaşım genellikle boyutlardan sonra yazılır.
 */
function detectSeriesExcludingDims(text: string, dimValues: Set<string>): string | null {
  const candidates = [...text.matchAll(SERIES_REGEX)]
    .map((m) => m[1])
    .filter((token): token is string => Boolean(token) && !dimValues.has(token));
  return candidates.at(-1) ?? null;
}

/**
 * Ham alasim alanından ("5083 H321", "AL5083", "5083-H321") 4 haneli seri sayısını çeker.
 * Bu fonksiyon SQL normalize'a ek olarak JS tarafında da kullanılır.
 */
export function parseSeriesFromRawAlasim(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/[1-9][0-9]{3}/);
  return m ? m[0] : null;
}

function detectTemper(text: string): string | null {
  const m = text.match(TEMPER_REGEX);
  return m && m.length > 0 ? m[0].toUpperCase() : null;
}

function detectProductType(text: string): string | null {
  for (const [type, keys] of Object.entries(productKeywords)) {
    if (keys.some((k) => text.includes(k))) return type;
  }
  return null;
}

function toNum(n: string): number {
  return Number(n.replace(",", "."));
}

function sortDims(nums: number[]): number[] {
  return [...nums].sort((a, b) => a - b);
}

function detectDimensions(text: string): { dim1: number | null; dim2: number | null; dim3: number | null; dim_text: string | null } {
  const groups: Array<{ nums: number[]; text: string }> = [];
  for (const match of text.matchAll(DIM_GROUP_REGEX)) {
    const a = toNum(match[1]);
    const b = toNum(match[2]);
    const c = match[3] ? toNum(match[3]) : null;
    const nums = [a, b];
    if (c !== null) nums.push(c);
    const sorted = sortDims(nums);
    groups.push({ nums: sorted, text: sorted.join("x") });
  }

  if (groups.length === 0) {
    return { dim1: null, dim2: null, dim3: null, dim_text: null };
  }

  groups.sort((g1, g2) => g2.nums.length - g1.nums.length);
  const best = groups[0];
  return {
    dim1: best.nums[0] ?? null,
    dim2: best.nums[1] ?? null,
    dim3: best.nums[2] ?? null,
    dim_text: best.text
  };
}

function seriesGroup(series: string | null): string | null {
  if (!series || series.length < 1) return null;
  return `${series[0]}000`;
}

export function buildSearchText(row: StockMasterRow): string {
  const raw = [
    row.stock_code,
    row.stock_name,
    row.stock_name2,
    row.description,
    row.category1,
    row.cinsi,
    row.alasim,
    row.tamper
  ].filter(Boolean).join(" ");
  return normalizeText(raw);
}

export function extractFeaturesFromStock(row: StockMasterRow): ExtractedFeatures {
  const text = buildSearchText(row);
  const series = row.alasim ? String(row.alasim).trim() || null : detectSeries(text);
  const temper = row.tamper ? String(row.tamper).trim().toUpperCase() || null : detectTemper(text);
  const product_type = row.cinsi ? String(row.cinsi).trim().toUpperCase() || null : detectProductType(text);
  const dims = detectDimensions(text);
  const erpDims = [row.erp_en, row.erp_boy, row.erp_yukseklik, row.erp_cap]
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0);
  const pickedDimsRaw = erpDims.length >= 2 ? erpDims.slice(0, 3) : [dims.dim1, dims.dim2, dims.dim3].filter((n): n is number => typeof n === "number");
  const pickedDims = sortDims(pickedDimsRaw);
  const canonicalDimText = pickedDims.length > 0 ? pickedDims.map((n) => Number(n)).join("x") : dims.dim_text;

  return {
    product_type,
    series,
    series_group: seriesGroup(series),
    temper,
    dim1: pickedDims[0] ?? null,
    dim2: pickedDims[1] ?? null,
    dim3: pickedDims[2] ?? null,
    dim_text: canonicalDimText,
    search_text: text
  };
}

export function extractFeaturesFromInput(rawText: string): ExtractedFromInput {
  const normalized = normalizeText(rawText);

  // 1. Önce boyutları tespit et
  const dims = detectDimensions(normalized);

  // 2. Boyutlarda geçen sayıları seri aday listesinden çıkar
  const dimValues = new Set(
    [dims.dim1, dims.dim2, dims.dim3]
      .filter((n): n is number => n !== null)
      .map(String)
  );

  // 3. Boyutlara karışmayan 4 haneli token'dan seri al
  const series = detectSeriesExcludingDims(normalized, dimValues);

  // 4. Temper ayrı algılanır (H321, T6 vb.) — alaşımla karıştırılmaz
  const temper = detectTemper(normalized);
  const product_type = detectProductType(normalized);

  return {
    normalized_text: normalized,
    series,
    series_group: seriesGroup(series),
    temper,
    product_type,
    dim1: dims.dim1,
    dim2: dims.dim2,
    dim3: dims.dim3,
    dim_text: dims.dim_text
  };
}

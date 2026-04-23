import { ParsedOrderDocument, ParsedOrderLine } from "./types";

const DIM_REGEX = /(\d+(?:[\.,]\d+)?)\s*[x*]\s*(\d+(?:[\.,]\d+)?)(?:\s*[x*]\s*(\d+(?:[\.,]\d+)?))?/i;
const DIM_FUZZY_REGEX = /(\d{1,4})\D{1,8}(\d{1,4})(?:\D{1,8}(\d{1,4}))?/i;
const FUZZY_TRIPLE_HINT_REGEX = /\b\d{1,4}\D{1,8}\d{1,4}\D{1,8}\d{1,4}\b/i;
const LABELED_DIM_REGEX = /(?:di[sş]\s*[çc]ap)\s*(\d+(?:[\.,]\d+)?)\s*mm?.*?(?:i[çc]\s*[çc]ap)\s*(\d+(?:[\.,]\d+)?)\s*mm?.*?(?:boy)\s*(\d+(?:[\.,]\d+)?)\s*mm?/i;
const QTY_REGEX = /(?:^|\s|>|-)(\d+(?:[\.,]\d+)?)\s*(ad\.?|adet|a[d1i]\.?|mik\.?|miktar)\b/i;
const SERIES_HINT_REGEX = /\b([1-9]\d{3})(?:\s*serisi)?\b/gi;
const CHAT_NOISE_REGEX = /(mesaj|iletildi|çarşamba|carsamba|günaydın|gunaydin|mailden|işleme alacağım|isleme alacagim|tamamdır|tamamdir|polinet|whatsapp|lte|vo\)|%|\d{1,2}:\d{2})/i;
const HEADER_SERIES_REGEX = /\b(?:AL|AA|A1)\s*([1-9]\d{3})\b/i;

function splitLines(raw: string): string[] {
  return raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}

function normalizeForParsing(line: string): string {
  return line
    .replace(/[aƒÆ’a¢â‚¬â€aƒâ€”a—]/g, "x")
    .replace(/[*]/g, "x")
    .replace(/[><]/g, " ")
    .replace(/[aƒÂ¢a¢â€šÂ¬a¢â‚¬ÂaƒÂ¢a¢â€šÂ¬a¢â‚¬Å“a¢â‚¬â€a¢â‚¬â€œ]/g, "-")
    .replace(/(?<=\d)\s*[Xx]\s*(?=\d)/g, "x")
    .replace(/\b(\d{1,3})\s+(?=\d{1,4}\s*x)/gi, "$1")
    .replace(/(?<=x)\s+(?=\d)/gi, "")
    .replace(/(?<=\d)\s+(?=x)/gi, "")
    .replace(/(?<=\d)[Il|](?=\d)/g, "1")
    .replace(/\b[Il]ox\b/gi, "10x")
    .replace(/\b1Sx\b/g, "15x")
    .replace(/\bSsx\b/g, "55x")
    .replace(/\bAJ\b/gi, "Ad")
    .replace(/\bA[l1I]\b/gi, "Ad")
    .replace(/\b0\s*(?=\d{1,3}x)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoiseLine(line: string): boolean {
  const normalized = normalizeForParsing(line);
  if (!normalized) return true;
  if (CHAT_NOISE_REGEX.test(normalized) && !/\d{1,4}\s*x\s*\d{1,4}/i.test(normalized)) return true;
  return false;
}

function normalizeDimNumber(n: string): string {
  let digits = String(n).replace(/[^\d.,]/g, "");
  if (!digits) return "";
  digits = digits.replace(",", ".");
  digits = digits.replace(/^0+(?=\d)/, "");
  return digits;
}

function toFiniteNumber(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(normalizeDimNumber(value));
  return Number.isFinite(n) ? n : null;
}

function normalizeDimensionParts(parts: string[]): number[] {
  return parts
    .map((part) => toFiniteNumber(part))
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
}

function parseQty(normalized: string): number | null {
  const qtyMatch = normalized.match(QTY_REGEX);
  if (!qtyMatch) return null;
  const qty = Number(String(qtyMatch[1]).replace(",", "."));
  return Number.isFinite(qty) ? qty : null;
}

function collectFuzzyDims(normalized: string, qty: number | null): number[] {
  const numericTokens = [...normalized.matchAll(/\d{1,5}(?:[\.,]\d+)?/g)]
    .map((m) => toFiniteNumber(m[0] ?? ""))
    .filter((n): n is number => n !== null)
    .filter((n) => n >= 2);

  if (numericTokens.length < 2) return [];

  const seriesTokenCandidates = new Set<number>();
  const headerSeries = normalized.match(/\b(?:AL|AA|A1)\s*([1-9]\d{3})\b/i)?.[1];
  if (headerSeries) {
    const parsed = Number(headerSeries);
    if (Number.isFinite(parsed)) seriesTokenCandidates.add(parsed);
  }
  const alphaSeries = normalized.match(/\b[A-Za-z]{3,}\s+([1-9]\d{3})\b/)?.[1];
  if (alphaSeries) {
    const parsed = Number(alphaSeries);
    if (Number.isFinite(parsed)) seriesTokenCandidates.add(parsed);
  }

  const filtered = [...numericTokens];

  if (seriesTokenCandidates.size > 0) {
    for (let i = 0; i < filtered.length; i += 1) {
      if (seriesTokenCandidates.has(filtered[i])) {
        filtered.splice(i, 1);
        i -= 1;
      }
    }
  }

  if (qty !== null) {
    const qtyIndex = filtered.lastIndexOf(qty);
    if (qtyIndex >= 0) {
      filtered.splice(qtyIndex, 1);
    }
  }

  if (filtered.length < 2) return [];
  const picked = filtered.slice(-3).map((n) => String(n));
  return normalizeDimensionParts(picked);
}

function extractSeries(line: string, dims: number[]): string | null {
  const dimSet = new Set(dims.map((n) => String(n)));
  const tokens = [...line.matchAll(SERIES_HINT_REGEX)]
    .map((m) => (m[1] ?? "").trim())
    .filter((token) => token.length === 4 && !dimSet.has(token));
  return tokens.length > 0 ? tokens[tokens.length - 1] : null;
}

function extractHeaderSeries(line: string): string | null {
  const match = normalizeForParsing(line).match(HEADER_SERIES_REGEX);
  return match?.[1] ?? null;
}

function looksLikeOrderLine(normalized: string): boolean {
  if (CHAT_NOISE_REGEX.test(normalized) && !/\d{1,4}\s*[x*]\s*\d{1,4}/i.test(normalized)) return false;
  return /\d{1,4}\s*[x*]\s*\d{1,4}/i.test(normalized)
    || LABELED_DIM_REGEX.test(normalized)
    || (/\b(ad|adet|a[d1i])\b/i.test(normalized) && /\d{4}\b/.test(normalized))
    || (FUZZY_TRIPLE_HINT_REGEX.test(normalized) && /\b[1-9]\d{3}\b/.test(normalized));
}

function computeConfidence(line: { dims: number[]; qty: number | null; series: string | null; raw: string }): number {
  let score = 0.2;
  if (line.dims.length >= 2) score += 0.35;
  if (line.dims.length === 3) score += 0.15;
  if (line.qty !== null) score += 0.15;
  if (line.series) score += 0.1;
  if (line.raw.length >= 8) score += 0.05;
  return Math.min(1, Number(score.toFixed(3)));
}

function parseSingleLine(line: string, headerContext: string | null, defaultSeries: string | null): ParsedOrderLine | null {
  const normalized = normalizeForParsing(line);
  if (!looksLikeOrderLine(normalized)) return null;

  const qty = parseQty(normalized);
  let dimMatch = normalized.match(DIM_REGEX);
  let dims: number[] = [];

  const labeledMatch = normalized.match(LABELED_DIM_REGEX);
  if (labeledMatch) {
    dims = normalizeDimensionParts([labeledMatch[1], labeledMatch[2], labeledMatch[3]].filter(Boolean) as string[]);
  }

  if (dims.length === 0 && !dimMatch) {
    const fuzzyDims = collectFuzzyDims(normalized, qty);
    if (fuzzyDims.length >= 2) {
      dims = fuzzyDims;
    }
  }

  if (dims.length === 0 && !dimMatch) {
    const fuzzy = normalized.match(DIM_FUZZY_REGEX);
    if (!fuzzy) return null;
    const hasHint = /\b(ad\.?|adet|a[d1i]\.?)\b/i.test(normalized)
      || /\b\d{4}\b/.test(normalized)
      || FUZZY_TRIPLE_HINT_REGEX.test(normalized);
    if (!hasHint) return null;
    dimMatch = [fuzzy[0], fuzzy[1], fuzzy[2], fuzzy[3]];
  }

  if (dims.length === 0 && dimMatch) {
    dims = normalizeDimensionParts([dimMatch[1], dimMatch[2], dimMatch[3]].filter(Boolean) as string[]);
  }
  if (dims.length < 2) return null;

  const series = extractSeries(normalized, dims) ?? defaultSeries;
  const query = [headerContext, normalized].filter(Boolean).join(" ").trim();

  return {
    raw: line,
    query,
    normalized_line: normalized,
    dim_text: dims.join("x"),
    dim1: dims[0] ?? null,
    dim2: dims[1] ?? null,
    dim3: dims[2] ?? null,
    qty,
    series,
    header_context: headerContext,
    confidence: computeConfidence({ dims, qty, series, raw: line })
  };
}

function scoreRichness(item: ParsedOrderLine): number {
  let score = 0;
  if (item.series) score += 3;
  if (item.qty !== null) score += 2;
  if (item.header_context) score += 1;
  score += item.raw.length / 1000;
  return score;
}

function dedupeLines(items: ParsedOrderLine[]): ParsedOrderLine[] {
  const map = new Map<string, ParsedOrderLine>();
  for (const item of items) {
    const key = [item.dim_text ?? "", item.qty ?? "", item.header_context ?? ""].join("|");
    const current = map.get(key);
    if (!current || scoreRichness(item) > scoreRichness(current)) {
      map.set(key, item);
    }
  }
  return [...map.values()];
}

function extractEmbeddedSegments(raw: string, headerContext: string | null, defaultSeries: string | null): ParsedOrderLine[] {
  const cleaned = normalizeForParsing(raw).replace(/\r/g, " ");
  const pattern = /(\d{1,4}(?:\s*[x]\s*\d{1,4}){2})(?:\s*[-]?\s*(\d{1,3})\s*(?:ad\.?|adet|a[d1i]\.?))?(?:\s*[-]?\s*((?:[1-9]\d{3})(?:\s*serisi)?))?/gi;
  const items: ParsedOrderLine[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(cleaned)) !== null) {
    const rawLine = [match[1], match[2] ? `${match[2]} Ad.` : "", match[3] ?? ""].filter(Boolean).join(" ");
    const parsed = parseSingleLine(rawLine, headerContext, defaultSeries);
    if (parsed) items.push(parsed);
  }

  return items;
}

function detectHeaderContext(lines: string[]): string | null {
  const header = lines.find((line) => !isNoiseLine(line) && !DIM_REGEX.test(line) && /\p{L}/u.test(line) && line.length <= 80);
  return header ?? null;
}

export function parseOrderDocument(rawText: string, sourceType: ParsedOrderDocument["source_type"]): ParsedOrderDocument {
  const lines = splitLines(rawText).filter((line) => !isNoiseLine(line));
  const headerContext = detectHeaderContext(lines);
  const defaultSeries = lines.map((line) => extractHeaderSeries(line)).find((series) => Boolean(series)) ?? null;
  const lineItems = lines
    .map((line) => parseSingleLine(line, headerContext, defaultSeries))
    .filter((item): item is ParsedOrderLine => item !== null);
  const shouldUseEmbeddedSegments = sourceType === "image" || sourceType === "pdf_scanned";
  const embeddedItems = shouldUseEmbeddedSegments
    ? extractEmbeddedSegments(lines.join("\n"), headerContext, defaultSeries)
        .map((item) => ({ ...item, series: item.series ?? defaultSeries }))
    : [];
  const items = dedupeLines([...lineItems, ...embeddedItems]);
  const parserConfidence = items.length > 0
    ? Number((items.reduce((sum, item) => sum + item.confidence, 0) / items.length).toFixed(3))
    : 0;

  return {
    source_type: sourceType,
    extracted_text: rawText,
    header_context: headerContext,
    items,
    parser_confidence: parserConfidence,
    extraction_method: null
  };
}

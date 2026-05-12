import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import Tesseract from "tesseract.js";
import * as XLSX from "xlsx";
import { ParsedOrderDocument, ParsedOrderLine, parseOrderDocument } from "@smp/common";
import { annotateMethod, extractWithGoogleVision, extractWithLlmFallback, extractWithLlmImageFallback, parserNeedsFallback } from "./ai-extract";
import { buildFingerprint, findBestExtractionProfile } from "./extraction-learning";
import { findBestInstructionPolicy } from "./instruction-policies";

type SupportedSourceType = ParsedOrderDocument["source_type"];

const ocrServiceUrl = process.env["OCR_SERVICE_URL"]?.trim() ?? "";
const likelyOrderLinePattern = /\d{1,4}\s*[xX*]\s*\d{1,4}/;
const likelyFuzzyTriplePattern = /\b\d{1,4}\D{0,8}\d{1,4}\D{0,8}\d{1,4}\b/;
const likelyQtyPattern = /\b\d{1,3}\s*(?:ad\.?|adet|a[d1i]\.?)\b/i;
const likelySeriesHeaderPattern = /\b(?:AL|AA|A1)\s*[1-9]\d{3}\b/i;
const hardNoisePattern = /(mesaj|iletildi|çarşamba|carsamba|günaydın|gunaydin|mailden|işleme alacağım|isleme alacagim|tamamdır|tamamdir|polinet|lte|whatsapp|vo\)|^\d{1,2}:\d{2}$)/i;

function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

function cleanupImageText(raw: string): string {
  const normalized = normalizeExtractedText(raw)
    .replace(/\b1Sx\b/g, "15x")
    .replace(/\bSsx\b/gi, "55x")
    .replace(/\blox\b/gi, "10x")
    .replace(/\bAJ\b/gi, "Ad")
    .replace(/\bA[l1I]\b/gi, "Ad")
    .replace(/\b(\d{1,3})\s+(?=\d{1,4}\s*x)/gi, "$1")
    .replace(/(?<=x)\s+(?=\d)/gi, "")
    .replace(/(?<=\d)\s+(?=x)/gi, "")
    .replace(/\bAd\s*([1-9]\d{3})(?=\d{1,4}\s*x)/gi, "AL $1\n")
    .replace(/\b(AL|AA|A1)\s*([1-9]\d{3})(?=\d{1,4}\s*x)/gi, "$1 $2\n");

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const expanded = lines.flatMap((line) => line
    .replace(/((?:\d{1,4}\s*[xX*]\s*){1,2}\d{1,4}\s*-?\s*\d{0,3}\s*(?:Ad\.?|Adet|A[d1i]\.?)?)(?=\s+\d{1,4}\s*[xX*]\s*\d{1,4})/gi, "$1\n")
    .split("\n")
    .map((part) => part.trim())
    .filter((part) => part.length > 0));

  const cleaned = expanded.filter((line) => {
    const hasOrderLikeSignal = likelyOrderLinePattern.test(line)
      || likelySeriesHeaderPattern.test(line)
      || (likelyFuzzyTriplePattern.test(line) && (likelyQtyPattern.test(line) || /\b[1-9]\d{3}\b/.test(line)));
    const looseNumericSignal = ((line.match(/\d{1,4}/g) ?? []).length >= 3)
      && /[-xX*]/.test(line);
    if (hardNoisePattern.test(line) && !hasOrderLikeSignal && !looseNumericSignal) {
      return false;
    }
    return hasOrderLikeSignal || looseNumericSignal;
  });

  return cleaned.join("\n").trim() || normalized;
}

function inferSourceType(fileName: string, mimeType: string | undefined, extractedText = ""): SupportedSourceType {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  if (["xlsx", "xls", "csv"].includes(ext)) return "excel";
  if (["docx", "doc"].includes(ext)) return "docx";
  if (mimeType?.startsWith("image/")) return "image";
  if (ext === "pdf") return extractedText.trim().length > 20 ? "pdf_text" : "pdf_scanned";
  return "plain_text";
}

function worksheetToText(sheet: XLSX.WorkSheet): string {
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    raw: false,
    blankrows: false
  });

  return rows
    .map((row) => row.filter((cell) => cell !== null && String(cell).trim().length > 0).join(" "))
    .filter((line) => line.length > 0)
    .join("\n");
}

function normalizeHeaderName(value: unknown): string {
  return String(value ?? "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toCellNumber(value: unknown): number | null {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!raw) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function toCellText(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw.length > 0 ? raw : null;
}

function parseDimensionText(value: unknown): number[] {
  const raw = String(value ?? "")
    .trim()
    .replace(/,/g, ".");
  if (!raw || !/[xX*×]/.test(raw)) return [];

  const parts = raw
    .split(/[xX*×]/)
    .map((part) => {
      const match = part.match(/\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : null;
    })
    .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);

  return parts.length >= 2 && parts.length <= 4 ? parts.slice(0, 3) : [];
}

function findDimensionTextIndex(headers: string[], rows: unknown[][]): number {
  let bestIndex = -1;
  let bestScore = 0;
  const maxColumns = Math.max(headers.length, ...rows.slice(0, 20).map((row) => row.length));

  for (let index = 0; index < maxColumns; index += 1) {
    const header = headers[index] ?? "";
    const headerScore = /\bolcu|\bolculer|\bolculeri|\bebat\b|\bdimension\b|\bsize\b|\bmeasure\b/.test(header) ? 5 : 0;
    const sampleScore = rows
      .slice(0, 20)
      .reduce((sum, row) => sum + (parseDimensionText(row[index]).length >= 2 ? 1 : 0), 0);
    const score = headerScore + sampleScore;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestScore > 0 ? bestIndex : -1;
}

function findQuantityIndex(headers: string[], rows: unknown[][]): number {
  let bestIndex = -1;
  let bestScore = 0;
  const maxColumns = Math.max(headers.length, ...rows.slice(0, 20).map((row) => row.length));

  for (let index = 0; index < maxColumns; index += 1) {
    const header = headers[index] ?? "";
    const headerScore = /\badet\b|\bmiktar\b|\bmikt\b|\bmik\b|\bqty\b|\bquantity\b/.test(header) ? 10 : 0;
    const sampleScore = rows
      .slice(0, 20)
      .reduce((sum, row) => {
        const value = toCellNumber(row[index]);
        return sum + (value !== null && value > 0 && value <= 100000 ? 1 : 0);
      }, 0);
    const score = headerScore + sampleScore;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestScore >= 3 ? bestIndex : -1;
}

function preferDetectedIndex(currentIndex: number, detectedIndex: number): number {
  return detectedIndex >= 0 ? detectedIndex : currentIndex;
}

function readRowDimensions(row: unknown[], explicitDimIndexes: number[], dimensionTextIndex: number): number[] {
  const explicitDims = explicitDimIndexes
    .map((index) => toCellNumber(row[index]))
    .filter((value): value is number => value !== null && value > 0);
  if (explicitDims.length >= 2) return explicitDims;

  if (dimensionTextIndex >= 0) {
    const textDims = parseDimensionText(row[dimensionTextIndex]);
    if (textDims.length >= 2) return textDims;
  }

  for (let index = 0; index < row.length; index += 1) {
    const textDims = parseDimensionText(row[index]);
    if (textDims.length >= 2) return textDims;
  }

  return [];
}

function normalizeCuttingValue(value: unknown): string | null {
  const normalized = normalizeHeaderName(value);
  if (!normalized) return null;
  if (/\byok\b|\bhayir\b|\bno\b|kesimsiz/.test(normalized)) return "Kesim Yok";
  if (/\bvar\b|\bevet\b|\byes\b|kesimli|kesim/.test(normalized)) return "Kesim Var";
  return toCellText(value);
}

function normalizeOriginValue(value: unknown): string | null {
  const normalized = normalizeHeaderName(value);
  if (!normalized) return null;
  if (/yerli|domestic/.test(normalized)) return "YERL\u0130";
  if (/ithal|import|imported/.test(normalized)) return "\u0130THAL";
  return toCellText(value);
}

function extractSeries(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const normalized = normalizeHeaderName(raw);
  const exact = normalized.match(/\b([1-9]\d{3})\b/);
  if (exact) return exact[1];

  const family = normalized.match(/\b([1-9])\s*(?:x{3}|xxx|000)\b/)
    || normalized.match(/\b([1-9])\s*(?:bin|seri|serisi)\b/);
  if (family) return `${family[1]}000`;

  return null;
}

function findColumnIndex(headers: string[], patterns: RegExp[]): number {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
}

function splitPlainTextTableLine(line: string): string[] {
  if (line.includes("\t")) {
    return line.split("\t").map((cell) => cell.trim());
  }
  if (line.includes(";")) {
    return line.split(";").map((cell) => cell.trim());
  }
  return line.split(/\s{2,}/).map((cell) => cell.trim());
}

function parseLoosePlainTextTableLine(line: string): string[] | null {
  const match = line.trim().match(/^(.+?)\s+([1-9]\d{3}(?:[-\s][^\s]+)?)\s+(\d+(?:[\.,]\d+)?\s*[xX*×]\s*\d+(?:[\.,]\d+)?(?:\s*[xX*×]\s*\d+(?:[\.,]\d+)?)?)\s+(\d+(?:[\.,]\d+)?)\s+(\d+(?:[\.,]\d+)?)\s+(.+)$/);
  return match ? match.slice(1).map((cell) => cell.trim()) : null;
}

function parsePlainTextTableDocument(rawText: string): ParsedOrderDocument | null {
  const lines = rawText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;

  const headerIndex = lines.findIndex((line) => {
    const normalized = normalizeHeaderName(line);
    return normalized.includes("malzeme")
      && (normalized.includes("olcu") || normalized.includes("ebat") || normalized.includes("dimension"))
      && (normalized.includes("adet") || normalized.includes("miktar"));
  });
  if (headerIndex < 0) return null;

  const headers = splitPlainTextTableLine(lines[headerIndex]).map(normalizeHeaderName);
  const rows = lines.slice(headerIndex + 1).map((line) => splitPlainTextTableLine(line));
  const hasDelimitedRows = rows.some((row) => row.length >= Math.min(headers.length, 4));
  const effectiveRows = hasDelimitedRows
    ? rows
    : lines.slice(headerIndex + 1).map((line) => parseLoosePlainTextTableLine(line)).filter((row): row is string[] => Boolean(row));
  const effectiveHeaders = hasDelimitedRows
    ? headers
    : ["musteri parca no", "malzeme cinsi", "malzeme olculeri", "adet", "fiyat", "musteri no"];

  if (effectiveRows.length === 0) return null;

  const customerPartNoIndex = findColumnIndex(effectiveHeaders, [/\bmusteri\s+parca\b/, /\bcustomer\s+part\b/, /\bpart\s+no\b/]);
  const materialIndex = findColumnIndex(effectiveHeaders, [/\bmalzeme\s+cinsi\b/, /\bmalzeme\b/, /\bmaterial\b/, /\balasim\b/]);
  const dimensionIndex = findColumnIndex(effectiveHeaders, [/\bmalzeme\s+olcu/, /\bolcu/, /\bebat\b/, /\bdimension\b/, /\bsize\b/]);
  const qtyIndex = findColumnIndex(effectiveHeaders, [/\badet\b/, /\bmiktar\b/, /\bqty\b/, /\bquantity\b/]);
  const unitPriceIndex = findColumnIndex(effectiveHeaders, [/\bfiyat\b/, /\bbirim\s+fiyat\b/, /\bprice\b/]);
  const customerNoIndex = findColumnIndex(effectiveHeaders, [/\bmusteri\s+no\b/, /\bcustomer\s+no\b/, /\bcari\s+no\b/]);

  if (dimensionIndex < 0 || qtyIndex < 0) return null;

  const items: ParsedOrderLine[] = [];
  for (const row of effectiveRows) {
    const dims = parseDimensionText(row[dimensionIndex]);
    if (dims.length < 2) continue;

    const sortedDims = [...dims].sort((a, b) => a - b);
    const material = materialIndex >= 0 ? toCellText(row[materialIndex]) : null;
    const series = extractSeries(material);
    const qty = toCellNumber(row[qtyIndex]);
    const customerPartNo = customerPartNoIndex >= 0 ? toCellText(row[customerPartNoIndex]) : null;
    const customerNo = customerNoIndex >= 0 ? toCellText(row[customerNoIndex]) : null;
    const headerContext = [customerPartNo, material, customerNo].filter(Boolean).join(" | ") || null;
    const raw = [
      qty ? `${qty} ADET` : "",
      `OLCU ${dims.join("x")}`,
      material ?? "",
      customerPartNo ?? ""
    ].filter(Boolean).join(" ");

    items.push({
      raw,
      query: [headerContext, sortedDims.join("x"), series ? `seri ${series}` : ""].filter(Boolean).join(" ").trim(),
      normalized_line: raw,
      dim_text: sortedDims.join("x"),
      dim1: sortedDims[0] ?? null,
      dim2: sortedDims[1] ?? null,
      dim3: sortedDims[2] ?? null,
      qty,
      series,
      alasim: series,
      temper: null,
      birimFiyat: unitPriceIndex >= 0 ? toCellNumber(row[unitPriceIndex]) : null,
      musteriNo: customerNo,
      musteriParcaNo: customerPartNo,
      header_context: headerContext,
      confidence: qty !== null ? 0.97 : 0.9
    });
  }

  if (items.length === 0) return null;

  return {
    source_type: "plain_text",
    extracted_text: rawText,
    header_context: null,
    items,
    parser_confidence: Number((items.reduce((sum, item) => sum + item.confidence, 0) / items.length).toFixed(3)),
    extraction_method: "plain_text_table"
  };
}

function plainTextNeedsLlmCompletion(rawText: string, doc: ParsedOrderDocument): boolean {
  if (doc.items.length === 0) return true;
  if (doc.extraction_method !== "plain_text_table") return true;
  const normalized = normalizeHeaderName(rawText);
  const mentionsPrice = /\b(fiyat|b\s*fiyat|bfiyat|birim\s+fiyat|price|unit\s+price|tanesi|birimi|tl|try|usd|eur)\b/.test(normalized);
  if (mentionsPrice && doc.items.some((item) => item.birimFiyat == null)) return true;

  const mentionsCustomer = /\b(musteri|customer|cari|parca\s+no|part\s+no)\b/.test(normalized);
  if (mentionsCustomer && doc.items.some((item) => !item.musteriNo && !item.musteriParcaNo)) return true;

  return false;
}

function mergeLlmCompletion(base: ParsedOrderDocument, completion: ParsedOrderDocument): ParsedOrderDocument {
  if (base.items.length !== completion.items.length) {
    return completion;
  }

  return {
    ...base,
    extraction_method: `${base.extraction_method || "plain_text"}+llm_completion`,
    items: base.items.map((item, index) => {
      const enriched = completion.items[index];
      return {
        ...item,
        qty: item.qty ?? enriched.qty ?? null,
        series: item.series ?? enriched.series ?? null,
        alasim: item.alasim ?? enriched.alasim ?? enriched.series ?? null,
        temper: item.temper ?? enriched.temper ?? null,
        kg: item.kg ?? enriched.kg ?? null,
        birimFiyat: item.birimFiyat ?? enriched.birimFiyat ?? null,
        talasMik: item.talasMik ?? enriched.talasMik ?? null,
        musteriNo: item.musteriNo ?? enriched.musteriNo ?? null,
        musteriParcaNo: item.musteriParcaNo ?? enriched.musteriParcaNo ?? null,
        kesimDurumu: item.kesimDurumu ?? enriched.kesimDurumu ?? null,
        mensei: item.mensei ?? enriched.mensei ?? null,
        header_context: item.header_context ?? enriched.header_context ?? null,
        query: [item.query, enriched.query].filter(Boolean).join(" ").trim()
      };
    })
  };
}

function buildInstructionPatterns(instruction: string | null | undefined, bucket: "qty" | "x" | "y" | "z" | "material" | "part" | "desc"): RegExp[] {
  const normalized = normalizeHeaderName(instruction ?? "");
  if (!normalized) return [];

  const hints: string[] = [];
  const keywordMap: Record<typeof bucket, string[]> = {
    qty: ["mikt", "miktar", "adet", "qty", "quantity", "mik"],
    x: ["x yonu", "en", "genislik"],
    y: ["y yonu", "ic cap", "ick ap", "kalinlik"],
    z: ["z yonu", "boy", "uzunluk"],
    material: ["malzeme", "seri", "alasim"],
    part: ["parca", "parca numarasi", "kod", "ref"],
    desc: ["aciklama", "not", "tanim"]
  };

  if (!keywordMap[bucket].some((token) => new RegExp(`\\b${token.replace(/\s+/g, "\\s+")}\\b`).test(normalized))) {
    return [];
  }

  const headerMatches = normalized.match(/["“” '"]?([a-z0-9]+(?:\s+[a-z0-9]+){0,3})["“” '"]?\s*(?:kolon|alan|sutun|sütun|header|baslik|başlık)/g) ?? [];
  for (const match of headerMatches) {
    const cleaned = normalizeHeaderName(match)
      .replace(/\b(kolon|alan|sutun|sütun|header|baslik|başlık)\b/g, "")
      .trim();
    if (cleaned) hints.push(cleaned);
  }

  const explicitTokens = normalized.match(/\b(?:qty|quantity|mik|mikt|miktar|adet|x yonu|y yonu|z yonu|en|genislik|kalinlik|boy|uzunluk|malzeme|seri|alasim|parca numarasi|kod|ref|aciklama|not|tanim)\b/g) ?? [];
  for (const token of explicitTokens) {
    if (!hints.includes(token)) hints.push(token);
  }

  return hints
    .filter(Boolean)
    .map((hint) => new RegExp(`\\b${hint.replace(/\s+/g, "\\s+")}\\b`));
}

const openAiApiKey = process.env["OPENAI_API_KEY"]?.trim() ?? "";
const openAiModel = process.env["OPENAI_STRUCTURED_MODEL"]?.trim() || "gpt-4.1-mini";

interface ColumnMapping {
  qtyIndex: number;
  xIndex: number;
  yIndex: number;
  zIndex: number;
  materialIndex: number;
  alloyIndex: number;
  temperIndex: number;
  partIndex: number;
  descIndex: number;
  kgIndex: number;
  unitPriceIndex: number;
  scrapIndex: number;
  customerNoIndex: number;
  customerPartNoIndex: number;
  cuttingIndex: number;
  originIndex: number;
}

async function resolveColumnMappingWithLlm(
  rawHeaders: unknown[],
  sampleRows: unknown[][],
  instruction: string | null | undefined
): Promise<ColumnMapping | null> {
  if (!openAiApiKey) return null;

  try {
    const headerList = rawHeaders.map((h, i) => `${i}: "${String(h ?? "")}"`).join("\n");
    const sampleData = sampleRows.slice(0, 3).map((row, ri) =>
      `Satır ${ri + 1}: ${(row as unknown[]).map((cell, ci) => `[${ci}]=${String(cell ?? "")}`).join(", ")}`
    ).join("\n");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiApiKey}`
      },
      body: JSON.stringify({
        model: openAiModel,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: [
              "Bir alüminyum/metal sipariş Excel dosyasının kolon başlıklarını analiz ediyorsun.",
              "Her kolon için aşağıdaki alanlardan birine eşleme yap. Eşleşme yoksa -1 döndür.",
              "",
              "Alanlar:",
              "- qtyIndex: Miktar/adet kolonu (sipariş edilen parça sayısı)",
              "- xIndex: En/genişlik boyutu kolonu (mm, X yönü)",
              "- yIndex: Kalınlık/et kalınlığı boyutu kolonu (mm, Y yönü, genellikle en küçük boyut)",
              "- zIndex: Boy/uzunluk boyutu kolonu (mm, Z yönü, genellikle en büyük boyut)",
              "- materialIndex: Malzeme/alaşım/seri kolonu (örn: 6000 AL, 5083, AA6061)",
              "- partIndex: Parça numarası/referans kodu kolonu",
              "- descIndex: Açıklama/tanım/not kolonu",
              "",
              "Kurallar:",
              "- Kolon başlığı VE örnek veriye birlikte bakarak karar ver.",
              "- Kullanıcı talimatı varsa ona öncelik ver.",
              "- Aynı kolonu birden fazla alana ATAMA.",
              "- Boyut değerlerinden hangisinin kalınlık/en/boy olduğunu değerlere bakarak tahmin et."
            ].join("\n")
          },
          {
            role: "user",
            content: [
              "Kolon başlıkları:",
              headerList,
              "",
              "Örnek veriler:",
              sampleData,
              "",
              instruction ? `Kullanıcı talimatı: ${instruction}` : ""
            ].filter(Boolean).join("\n")
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "column_mapping",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                qtyIndex: { type: "integer" },
                xIndex: { type: "integer" },
                yIndex: { type: "integer" },
                zIndex: { type: "integer" },
                materialIndex: { type: "integer" },
                alloyIndex: { type: "integer" },
                temperIndex: { type: "integer" },
                partIndex: { type: "integer" },
                descIndex: { type: "integer" },
                kgIndex: { type: "integer" },
                unitPriceIndex: { type: "integer" },
                scrapIndex: { type: "integer" },
                customerNoIndex: { type: "integer" },
                customerPartNoIndex: { type: "integer" },
                cuttingIndex: { type: "integer" },
                originIndex: { type: "integer" },
                reasoning: { type: "string" }
              },
              required: ["qtyIndex", "xIndex", "yIndex", "zIndex", "materialIndex", "alloyIndex", "temperIndex", "partIndex", "descIndex", "kgIndex", "unitPriceIndex", "scrapIndex", "customerNoIndex", "customerPartNoIndex", "cuttingIndex", "originIndex", "reasoning"]
            }
          }
        }
      })
    });

    if (!response.ok) return null;

    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as ColumnMapping & { reasoning: string };
    console.log("[LLM column mapping]", parsed.reasoning);
    return parsed;
  } catch {
    return null;
  }
}

async function buildExcelDocument(workbook: XLSX.WorkBook, instruction?: string | null): Promise<ParsedOrderDocument | null> {
  const items: ParsedOrderLine[] = [];
  const extractedLines: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      blankrows: false
    });
    if (rows.length < 2) continue;

    const rawHeaders = rows[0] as unknown[];
    const headers = rawHeaders.map((cell) => normalizeHeaderName(cell));

    let qtyIndex: number;
    let xIndex: number;
    let yIndex: number;
    let zIndex: number;
    let materialIndex: number;
    let alloyIndex: number;
    let temperIndex: number;
    let partIndex: number;
    let descIndex: number;
    let kgIndex: number;
    let unitPriceIndex: number;
    let scrapIndex: number;
    let customerNoIndex: number;
    let customerPartNoIndex: number;
    let cuttingIndex: number;
    let originIndex: number;

    const llmMapping = await resolveColumnMappingWithLlm(rawHeaders, rows.slice(1) as unknown[][], instruction);

    if (llmMapping) {
      qtyIndex = llmMapping.qtyIndex;
      xIndex = llmMapping.xIndex;
      yIndex = llmMapping.yIndex;
      zIndex = llmMapping.zIndex;
      materialIndex = llmMapping.materialIndex;
      alloyIndex = llmMapping.alloyIndex;
      temperIndex = llmMapping.temperIndex;
      partIndex = llmMapping.partIndex;
      descIndex = llmMapping.descIndex;
      kgIndex = llmMapping.kgIndex;
      unitPriceIndex = llmMapping.unitPriceIndex;
      scrapIndex = llmMapping.scrapIndex;
      customerNoIndex = llmMapping.customerNoIndex;
      customerPartNoIndex = llmMapping.customerPartNoIndex;
      cuttingIndex = llmMapping.cuttingIndex;
      originIndex = llmMapping.originIndex;
    } else {
      qtyIndex = findColumnIndex(headers, [/\bmikt\b/, /\bmiktar\b/, /\bmik\b/, /\badet\b/, /\bad\b/, /\bqty\b/, /\bquantity\b/, ...buildInstructionPatterns(instruction, "qty")]);
      xIndex = findColumnIndex(headers, [/\bx yonu\b/, /^x$/, /\ben\b/, /\bgenislik\b/, ...buildInstructionPatterns(instruction, "x")]);
      yIndex = findColumnIndex(headers, [/\by yonu\b/, /^y$/, /\bick ap\b/, /\bic cap\b/, /\bkalinlik\b/, ...buildInstructionPatterns(instruction, "y")]);
      zIndex = findColumnIndex(headers, [/\bz yonu\b/, /^z$/, /\bboy\b/, /\buzunluk\b/, ...buildInstructionPatterns(instruction, "z")]);
      materialIndex = findColumnIndex(headers, [/\bmalzeme\b/, /\bseri\b/, /\balasim\b/, ...buildInstructionPatterns(instruction, "material")]);
      alloyIndex = findColumnIndex(headers, [/\balasim\b/, /\balloy\b/, /\bseri\b/]);
      temperIndex = findColumnIndex(headers, [/\btamper\b/, /\btemper\b/, /\bsertlik\b/]);
      partIndex = findColumnIndex(headers, [/\bparca numarasi\b/, /\bkod\b/, /\bref\b/, ...buildInstructionPatterns(instruction, "part")]);
      descIndex = findColumnIndex(headers, [/\baciklama\b/, /\bnot\b/, /\btanim\b/, ...buildInstructionPatterns(instruction, "desc")]);
      kgIndex = findColumnIndex(headers, [/\bkg\b/, /\bagirlik\b/, /\bnet kg\b/, /\bbrut kg\b/]);
      unitPriceIndex = findColumnIndex(headers, [/\bbirim fiyat\b/, /\bfiyat\b/, /\bunit price\b/, /\bprice\b/]);
      scrapIndex = findColumnIndex(headers, [/\btalas\b/, /\bfire\b/, /\bscrap\b/]);
      customerNoIndex = findColumnIndex(headers, [/\bmusteri no\b/, /\bcari no\b/, /\bcustomer no\b/, /\bcustomer code\b/]);
      customerPartNoIndex = findColumnIndex(headers, [/\bmusteri parca\b/, /\bcustomer part\b/, /\bpart no\b/]);
      cuttingIndex = findColumnIndex(headers, [/\bkesim\b/, /\bcutting\b/]);
      originIndex = findColumnIndex(headers, [/\bmensei\b/, /\borigin\b/, /\byerli ithal\b/]);
    }

    materialIndex = preferDetectedIndex(materialIndex, findColumnIndex(headers, [/\bmalzeme\b/, /\bmalzeme cinsi\b/, /\bmaterial\b/]));
    alloyIndex = preferDetectedIndex(alloyIndex, findColumnIndex(headers, [/\balasim\b/, /\balloy\b/, /\bseri\b/]));
    temperIndex = preferDetectedIndex(temperIndex, findColumnIndex(headers, [/\btamper\b/, /\btemper\b/, /\bsertlik\b/]));
    partIndex = preferDetectedIndex(partIndex, findColumnIndex(headers, [/\bparca numarasi\b/, /\bparca no\b/, /\bpart no\b/, /\bref\b/]));
    kgIndex = preferDetectedIndex(kgIndex, findColumnIndex(headers, [/\bkg\b/, /\bagirlik\b/, /\bnet kg\b/, /\bbrut kg\b/]));
    unitPriceIndex = preferDetectedIndex(unitPriceIndex, findColumnIndex(headers, [/\bbirim fiyat\b/, /\bfiyat\b/, /\bunit price\b/, /\bprice\b/]));
    scrapIndex = preferDetectedIndex(scrapIndex, findColumnIndex(headers, [/\btalas\b/, /\bfire\b/, /\bscrap\b/]));
    customerNoIndex = preferDetectedIndex(customerNoIndex, findColumnIndex(headers, [/\bmusteri no\b/, /\bcari no\b/, /\bcustomer no\b/, /\bcustomer code\b/]));
    cuttingIndex = preferDetectedIndex(cuttingIndex, findColumnIndex(headers, [/\bkesim\b/, /\bcutting\b/]));
    originIndex = preferDetectedIndex(originIndex, findColumnIndex(headers, [/\bmensei\b/, /\borigin\b/, /\byerli ithal\b/]));

    const detectedCustomerPartNoIndex = findColumnIndex(headers, [/\bmusteri parca\b/, /\bcustomer part\b/, /\bcust part\b/]);
    customerPartNoIndex = preferDetectedIndex(customerPartNoIndex, detectedCustomerPartNoIndex);
    if (customerNoIndex === detectedCustomerPartNoIndex && detectedCustomerPartNoIndex >= 0) {
      customerNoIndex = findColumnIndex(headers, [/\bmusteri no\b/, /\bcari no\b/, /\bcustomer no\b/, /\bcustomer code\b/]);
    }
    const detectedQtyIndex = findQuantityIndex(headers, rows.slice(1) as unknown[][]);
    if (detectedQtyIndex >= 0) {
      qtyIndex = detectedQtyIndex;
    }

    const usableDimIndexes = [xIndex, yIndex, zIndex].filter((index) => index >= 0);
    const dimensionTextIndex = findDimensionTextIndex(headers, rows.slice(1) as unknown[][]);

    for (const row of rows.slice(1)) {
      const dims = readRowDimensions(row, usableDimIndexes, dimensionTextIndex);
      if (dims.length < 2) continue;

      const sortedDims = [...dims].sort((a, b) => a - b);
      const qty = qtyIndex >= 0 ? toCellNumber(row[qtyIndex]) : null;
      const material = materialIndex >= 0 ? String(row[materialIndex] ?? "").trim() : "";
      const rawAlloy = alloyIndex >= 0 ? toCellText(row[alloyIndex]) : null;
      const alasim = extractSeries(rawAlloy) ?? extractSeries(material);
      const temper = temperIndex >= 0 ? toCellText(row[temperIndex]) : null;
      const series = alasim;
      const headerParts = [
        partIndex >= 0 ? String(row[partIndex] ?? "").trim() : "",
        customerPartNoIndex >= 0 ? String(row[customerPartNoIndex] ?? "").trim() : "",
        material,
        rawAlloy && rawAlloy !== material ? rawAlloy : "",
        temper ?? "",
        descIndex >= 0 ? String(row[descIndex] ?? "").trim() : ""
      ].filter(Boolean);
      const headerContext = [headerParts.join(" | "), instruction].filter(Boolean).join(" | ") || sheetName;
      const raw = [
        qty ? `${qty} ADET` : "",
        usableDimIndexes.length >= 2
          ? [
              xIndex >= 0 ? `X ${row[xIndex] ?? ""}` : "",
              yIndex >= 0 ? `Y ${row[yIndex] ?? ""}` : "",
              zIndex >= 0 ? `Z ${row[zIndex] ?? ""}` : ""
            ].filter(Boolean).join(" ")
          : `ÖLÇÜ ${dims.join("x")}`,
        material
      ].filter(Boolean).join(" ");

      items.push({
        raw,
        query: [headerContext, `${sortedDims.join("x")}`, series ? `seri ${series}` : ""].filter(Boolean).join(" ").trim(),
        normalized_line: raw,
        dim_text: sortedDims.join("x"),
        dim1: sortedDims[0] ?? null,
        dim2: sortedDims[1] ?? null,
        dim3: sortedDims[2] ?? null,
        qty,
        series,
        alasim,
        temper,
        kg: kgIndex >= 0 ? toCellNumber(row[kgIndex]) : null,
        birimFiyat: unitPriceIndex >= 0 ? toCellNumber(row[unitPriceIndex]) : null,
        talasMik: scrapIndex >= 0 ? toCellNumber(row[scrapIndex]) : null,
        musteriNo: customerNoIndex >= 0 ? toCellText(row[customerNoIndex]) : null,
        musteriParcaNo: customerPartNoIndex >= 0 ? toCellText(row[customerPartNoIndex]) : null,
        kesimDurumu: cuttingIndex >= 0 ? normalizeCuttingValue(row[cuttingIndex]) : null,
        mensei: originIndex >= 0 ? normalizeOriginValue(row[originIndex]) : null,
        header_context: headerContext || null,
        confidence: qty !== null ? 0.96 : 0.88
      });

      extractedLines.push(raw);
    }
  }

  if (items.length === 0) return null;

  return {
    source_type: "excel",
    extracted_text: extractedLines.join("\n"),
    header_context: null,
    items,
    parser_confidence: Number((items.reduce((sum, item) => sum + item.confidence, 0) / items.length).toFixed(3)),
    extraction_method: "excel",
    learning: null,
    debug: null
  };
}

async function extractTextFromOfficeBuffer(buffer: Buffer, fileName: string): Promise<string> {
  const ext = (fileName.split(".").pop() || "").toLowerCase();

  if (ext === "csv") {
    return buffer.toString("utf8");
  }

  if (["xlsx", "xls"].includes(ext)) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    return workbook.SheetNames.map((name) => worksheetToText(workbook.Sheets[name])).filter(Boolean).join("\n");
  }

  if (["docx", "doc"].includes(ext)) {
    const res = await mammoth.extractRawText({ buffer });
    return res.value;
  }

  if (ext === "pdf") {
    const res = await pdfParse(buffer);
    return res.text;
  }

  return buffer.toString("utf8");
}

async function extractTextViaOcrService(buffer: Buffer, fileName: string, mimeType: string | undefined): Promise<string | null> {
  if (!ocrServiceUrl) return null;

  try {
    const response = await fetch(ocrServiceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName,
        mimeType,
        contentBase64: buffer.toString("base64")
      })
    });

    if (!response.ok) return null;

    const data = await response.json() as { text?: string; lines?: string[] };
    if (typeof data.text === "string" && data.text.trim()) return data.text;
    if (Array.isArray(data.lines)) return data.lines.join("\n");
    return null;
  } catch {
    return null;
  }
}

async function extractTextViaOcrServiceDetailed(buffer: Buffer, fileName: string, mimeType: string | undefined): Promise<{ text: string | null; error: string | null }> {
  if (!ocrServiceUrl) return { text: null, error: "OCR_SERVICE_URL missing" };

  try {
    const response = await fetch(ocrServiceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName,
        mimeType,
        contentBase64: buffer.toString("base64")
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { text: null, error: `ocr_http_${response.status}: ${errorText.slice(0, 300)}` };
    }

    const data = await response.json() as { text?: string; lines?: string[] };
    if (typeof data.text === "string" && data.text.trim()) return { text: data.text, error: null };
    if (Array.isArray(data.lines)) return { text: data.lines.join("\n"), error: null };
    return { text: null, error: "ocr_empty_text" };
  } catch (error) {
    return { text: null, error: error instanceof Error ? error.message : "ocr_unknown_error" };
  }
}

async function extractTextFromImageBuffer(buffer: Buffer, fileName: string, mimeType: string | undefined): Promise<{ text: string; method: string; errors: Record<string, string | null> }> {
  const errors: Record<string, string | null> = {
    vision_error: null,
    ocr_error: null
  };

  const visionResult = await extractWithGoogleVision(buffer);
  errors.vision_error = visionResult.error;
  if (visionResult.text && visionResult.text.trim()) {
    return { text: visionResult.text, method: "google_vision", errors };
  }

  const ocrResult = await extractTextViaOcrServiceDetailed(buffer, fileName, mimeType);
  errors.ocr_error = ocrResult.error;
  if (ocrResult.text && ocrResult.text.trim()) {
    return { text: ocrResult.text, method: "ocr_service", errors };
  }

  const result = await Tesseract.recognize(buffer, "eng");
  return { text: result.data.text || "", method: "tesseract_fallback", errors };
}

function buildPreview(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

function buildDebugMeta(input: { forceAiFallback?: boolean }, extras?: Record<string, unknown>) {
  return {
    requested_mode: input.forceAiFallback ? "strong_ai" : "normal",
    ai_forced: Boolean(input.forceAiFallback),
    ...extras
  };
}

function lineRichnessScore(item: ParsedOrderLine): number {
  let score = item.confidence ?? 0;
  if (item.qty !== null) score += 0.4;
  if (item.series) score += 0.35;
  if (item.dim3 !== null) score += 0.2;
  score += (item.raw?.length ?? 0) / 500;
  return score;
}

function recomputeParserConfidence(items: ParsedOrderLine[]): number {
  return items.length > 0
    ? Number((items.reduce((sum, item) => sum + item.confidence, 0) / items.length).toFixed(3))
    : 0;
}

function imageLineIdentity(item: ParsedOrderLine): string {
  return [
    item.dim_text ?? "",
    item.series ?? "",
    item.header_context ?? ""
  ].join("|");
}

function choosePreferredImageLine(current: ParsedOrderLine, candidate: ParsedOrderLine): ParsedOrderLine {
  if (current.qty === null && candidate.qty !== null) return candidate;
  if (current.qty !== null && candidate.qty === null) return current;
  return lineRichnessScore(candidate) > lineRichnessScore(current) ? candidate : current;
}

function consolidateImageLines(items: ParsedOrderLine[]): ParsedOrderLine[] {
  const grouped = new Map<string, ParsedOrderLine[]>();

  for (const item of items) {
    const key = imageLineIdentity(item);
    const bucket = grouped.get(key) ?? [];
    const existingIndex = bucket.findIndex((entry) => entry.qty === item.qty || entry.qty === null || item.qty === null);

    if (existingIndex >= 0) {
      bucket[existingIndex] = choosePreferredImageLine(bucket[existingIndex], item);
    } else {
      bucket.push(item);
    }

    grouped.set(key, bucket);
  }

  return [...grouped.values()].flat();
}

function finalizeImageDocument(doc: ParsedOrderDocument): ParsedOrderDocument {
  const items = consolidateImageLines(doc.items);
  return {
    ...doc,
    items,
    parser_confidence: recomputeParserConfidence(items)
  };
}

function mergeParsedDocuments(primary: ParsedOrderDocument, secondary: ParsedOrderDocument, method: string): ParsedOrderDocument {
  const merged = new Map<string, ParsedOrderLine>();
  const upsert = (item: ParsedOrderLine) => {
    const key = [
      item.dim_text ?? "",
      item.qty ?? "",
      item.series ?? "",
      item.header_context ?? ""
    ].join("|");
    const current = merged.get(key);
    if (!current || lineRichnessScore(item) > lineRichnessScore(current)) {
      merged.set(key, item);
    }
  };

  primary.items.forEach(upsert);
  secondary.items.forEach(upsert);

  const items = [...merged.values()];
  const parserConfidence = recomputeParserConfidence(items);

  return {
    ...primary,
    items,
    parser_confidence: parserConfidence,
    extraction_method: method
  };
}

function estimateImageCandidateLineCount(text: string): number {
  return normalizeExtractedText(text)
    .split("\n")
    .filter((line) => {
      const numberCount = (line.match(/\d{1,4}/g) ?? []).length;
      if (numberCount < 3) return false;
      return likelyOrderLinePattern.test(line)
        || likelyFuzzyTriplePattern.test(line)
        || likelyQtyPattern.test(line);
    })
    .length;
}

function parseExpectedItemCount(instruction: string | null | undefined): number | null {
  const value = String(instruction ?? "");
  if (!value.trim()) return null;
  const match = value.match(/(\d{1,2})\s*(?:satir|satır|olcu|ölçü|kalem)/i);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isFinite(count) && count > 0 ? count : null;
}

function buildLearningMeta(args: {
  fingerprint: ReturnType<typeof buildFingerprint>;
  userInstruction: string | null;
  effectiveInstruction: string | null;
  matchedProfile: Awaited<ReturnType<typeof findBestExtractionProfile>>;
  matchedInstructionPolicy: Awaited<ReturnType<typeof findBestInstructionPolicy>>;
}) {
  return {
    fingerprint_text: args.fingerprint.text,
    fingerprint_hash: args.fingerprint.hash,
    fingerprint_json: args.fingerprint.json,
    user_instruction: args.userInstruction,
    effective_instruction: args.effectiveInstruction,
    applied_match_instruction: args.matchedProfile?.match_instruction ?? null,
    applied_match_policy: args.matchedInstructionPolicy?.policy_json?.matchPolicy ?? null,
    applied_profile_id: args.matchedProfile?.id ?? null,
    applied_profile_name: args.matchedProfile?.name ?? null,
    applied_instruction_policy_id: args.matchedInstructionPolicy?.id ?? null,
    applied_instruction_policy_name: args.matchedInstructionPolicy?.name ?? null,
    row_defaults: args.matchedInstructionPolicy?.policy_json?.rowDefaults ?? null
  };
}

export async function extractSourceDocument(input: {
  rawText?: string;
  fileName?: string;
  mimeType?: string;
  contentBase64?: string;
  forceAiFallback?: boolean;
  userInstruction?: string;
}): Promise<ParsedOrderDocument> {
  const normalizedInstruction = input.userInstruction?.trim() || null;

  if (input.rawText && input.rawText.trim()) {
    const normalizedText = normalizeExtractedText(input.rawText);
    const fingerprint = buildFingerprint({
      sourceType: "plain_text",
      sampleText: normalizedText
    });
    const matchedProfile = normalizedInstruction ? null : await findBestExtractionProfile(fingerprint);
    const matchedInstructionPolicy = normalizedInstruction ? null : await findBestInstructionPolicy(fingerprint);
    const effectiveInstruction = normalizedInstruction
      ?? matchedInstructionPolicy?.policy_json?.extractionPrompt
      ?? matchedProfile?.instruction_text
      ?? null;
    let parsed = parsePlainTextTableDocument(input.rawText) ?? annotateMethod(parseOrderDocument(normalizedText, "plain_text"), "plain_text");
    const shouldTryLlm = input.forceAiFallback === true
      || parsed.items.length === 0
      || Boolean(effectiveInstruction)
      || plainTextNeedsLlmCompletion(normalizedText, parsed);
    let fallbackAttempted = false;
    let fallbackSucceeded = false;
    if (shouldTryLlm) {
      fallbackAttempted = true;
      const llm = await extractWithLlmFallback(normalizedText, "plain_text", effectiveInstruction);
      if (llm.doc) {
        parsed = parsed.items.length > 0 && input.forceAiFallback !== true
          ? mergeLlmCompletion(parsed, llm.doc)
          : llm.doc;
        fallbackSucceeded = true;
      }
    }
    return {
      ...parsed,
      learning: buildLearningMeta({
        fingerprint,
        userInstruction: normalizedInstruction,
        effectiveInstruction,
        matchedProfile,
        matchedInstructionPolicy
      }),
      debug: {
        ...buildDebugMeta(input),
        fallback_attempted: fallbackAttempted,
        fallback_succeeded: fallbackSucceeded,
        raw_text_preview: buildPreview(parsed.extracted_text),
        item_count: parsed.items.length
      }
    };
  }

  if (!input.contentBase64 || !input.fileName) {
    throw new Error("rawText veya file icerigi gerekli.");
  }

  const buffer = Buffer.from(input.contentBase64, "base64");
  const inferred = inferSourceType(input.fileName, input.mimeType);

  if (inferred === "excel") {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const headerRows = workbook.SheetNames.flatMap((name) => {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: false, blankrows: false });
      return rows[0] ? [rows[0].map((cell) => String(cell ?? ""))] : [];
    });
    const fingerprint = buildFingerprint({
      sourceType: "excel",
      fileName: input.fileName,
      mimeType: input.mimeType,
      headers: headerRows.flat(),
      sheetNames: workbook.SheetNames,
      sampleText: headerRows.flat().join(" ")
    });
    const matchedProfile = normalizedInstruction ? null : await findBestExtractionProfile(fingerprint);
    const matchedInstructionPolicy = normalizedInstruction ? null : await findBestInstructionPolicy(fingerprint);
    const effectiveInstruction = normalizedInstruction
      ?? matchedInstructionPolicy?.policy_json?.extractionPrompt
      ?? matchedProfile?.instruction_text
      ?? null;
    const excelDoc = await buildExcelDocument(workbook, effectiveInstruction);
    if (excelDoc) {
      return {
        ...excelDoc,
        learning: buildLearningMeta({
          fingerprint,
          userInstruction: normalizedInstruction,
          effectiveInstruction,
          matchedProfile,
          matchedInstructionPolicy
        }),
        debug: {
          ...buildDebugMeta(input),
          fallback_attempted: false,
          fallback_succeeded: false,
          raw_text_preview: buildPreview(excelDoc.extracted_text),
          item_count: excelDoc.items.length
        }
      };
    }
  }

  if (inferred === "image") {
    const fingerprint = buildFingerprint({
      sourceType: "image",
      fileName: input.fileName,
      mimeType: input.mimeType
    });
    const matchedProfile = normalizedInstruction ? null : await findBestExtractionProfile(fingerprint);
    const matchedInstructionPolicy = normalizedInstruction ? null : await findBestInstructionPolicy(fingerprint);
    const effectiveInstruction = normalizedInstruction
      ?? matchedInstructionPolicy?.policy_json?.extractionPrompt
      ?? matchedProfile?.instruction_text
      ?? null;
    const extracted = await extractTextFromImageBuffer(buffer, input.fileName, input.mimeType);
    const normalized = cleanupImageText(extracted.text);
    let parsed = annotateMethod(parseOrderDocument(normalized, "image"), extracted.method);
    const rawParsed = annotateMethod(parseOrderDocument(normalizeExtractedText(extracted.text), "image"), `${extracted.method}_raw`);
    if (rawParsed.items.length > 0) {
      if (parsed.items.length === 0) {
        parsed = rawParsed;
      } else {
        const merged = mergeParsedDocuments(parsed, rawParsed, `${extracted.method}_hybrid`);
        if (merged.items.length > parsed.items.length || merged.parser_confidence >= parsed.parser_confidence) {
          parsed = merged;
        }
      }
    }
    let fallbackAttempted = false;
    let fallbackSucceeded = false;
    let llmTextError: string | null = null;
    let llmImageError: string | null = null;
    const candidateLineCount = estimateImageCandidateLineCount(extracted.text);
    const expectedItemCount = parseExpectedItemCount(normalizedInstruction);
    const parserLooksIncomplete = candidateLineCount >= Math.max(parsed.items.length + 2, 4)
      || (expectedItemCount !== null && parsed.items.length < expectedItemCount);

    if (input.forceAiFallback || normalizedInstruction || parserNeedsFallback(parsed) || parserLooksIncomplete) {
      fallbackAttempted = true;
      if (input.forceAiFallback || normalizedInstruction) {
        const llmImageResult = await extractWithLlmImageFallback(buffer, "image", input.mimeType, effectiveInstruction);
        llmImageError = llmImageResult.error;
        if (llmImageResult.doc && llmImageResult.doc.items.length > 0) {
          parsed = {
            ...llmImageResult.doc,
            extracted_text: normalized || llmImageResult.doc.extracted_text
          };
          fallbackSucceeded = true;
        } else {
          const llmTextResult = await extractWithLlmFallback(normalized, "image", effectiveInstruction);
          llmTextError = llmTextResult.error;
          if (llmTextResult.doc && llmTextResult.doc.items.length > 0) {
            parsed = llmTextResult.doc;
            fallbackSucceeded = true;
          }
        }
      } else {
        const llmTextResult = await extractWithLlmFallback(normalized, "image", effectiveInstruction);
        llmTextError = llmTextResult.error;
        if (llmTextResult.doc && llmTextResult.doc.items.length > 0) {
          parsed = llmTextResult.doc;
          fallbackSucceeded = true;
        } else {
          const llmImageResult = await extractWithLlmImageFallback(buffer, "image", input.mimeType, effectiveInstruction);
          llmImageError = llmImageResult.error;
          if (llmImageResult.doc && llmImageResult.doc.items.length > 0) {
            parsed = {
              ...llmImageResult.doc,
              extracted_text: normalized || llmImageResult.doc.extracted_text
            };
            fallbackSucceeded = true;
          }
        }
      }
    }

    return finalizeImageDocument({
      ...parsed,
      learning: buildLearningMeta({
        fingerprint,
        userInstruction: normalizedInstruction,
        effectiveInstruction,
        matchedProfile,
        matchedInstructionPolicy
      }),
      debug: {
        ...buildDebugMeta(input),
        fallback_attempted: fallbackAttempted,
        fallback_succeeded: fallbackSucceeded,
        raw_text_preview: buildPreview(parsed.extracted_text),
        item_count: parsed.items.length,
        expected_item_count: expectedItemCount,
        candidate_line_count: candidateLineCount,
        vision_error: extracted.errors.vision_error,
        llm_text_error: llmTextError,
        llm_image_error: llmImageError,
        ocr_error: extracted.errors.ocr_error
      }
    });
  }

  const extractedText = await extractTextFromOfficeBuffer(buffer, input.fileName);
  const normalized = normalizeExtractedText(extractedText);
  const sourceType = inferSourceType(input.fileName, input.mimeType, normalized);
  const fingerprint = buildFingerprint({
    sourceType,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sampleText: normalized
  });
  const matchedProfile = normalizedInstruction ? null : await findBestExtractionProfile(fingerprint);
  const matchedInstructionPolicy = normalizedInstruction ? null : await findBestInstructionPolicy(fingerprint);
  const effectiveInstruction = normalizedInstruction
    ?? matchedInstructionPolicy?.policy_json?.extractionPrompt
    ?? matchedProfile?.instruction_text
    ?? null;
  let parsed = annotateMethod(parseOrderDocument(normalized, sourceType), sourceType);
  if (effectiveInstruction && (parsed.items.length === 0 || sourceType === "docx" || sourceType === "pdf_text" || normalizedInstruction)) {
    const llm = await extractWithLlmFallback(normalized, sourceType, effectiveInstruction);
    if (llm.doc && llm.doc.items.length > 0) {
      parsed = llm.doc;
    }
  }
  return {
    ...parsed,
    learning: buildLearningMeta({
      fingerprint,
      userInstruction: normalizedInstruction,
      effectiveInstruction,
      matchedProfile,
      matchedInstructionPolicy
    }),
    debug: {
      ...buildDebugMeta(input),
      fallback_attempted: false,
      fallback_succeeded: false,
      raw_text_preview: buildPreview(parsed.extracted_text),
      item_count: parsed.items.length
    }
  };
}

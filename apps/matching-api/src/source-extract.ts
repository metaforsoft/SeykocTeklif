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
const hardNoisePattern = /(mesaj|iletildi|Ã§arÅŸamba|carsamba|gÃ¼naydÄ±n|gunaydin|mailden|iÅŸleme alacaÄŸÄ±m|isleme alacagim|tamamdÄ±r|tamamdir|polinet|lte|whatsapp|vo\)|^\d{1,2}:\d{2}$)/i;

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
    .replace(/Ä±/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toCellNumber(value: unknown): number | null {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!raw) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function findColumnIndex(headers: string[], patterns: RegExp[]): number {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
}

function buildInstructionPatterns(instruction: string | null | undefined, bucket: "qty" | "x" | "y" | "z" | "material" | "part" | "desc"): RegExp[] {
  const normalized = normalizeHeaderName(instruction ?? "");
  if (!normalized) return [];

  const hints: string[] = [];
  const keywordMap: Record<typeof bucket, string[]> = {
    qty: ["mikt", "miktar", "adet", "ad", "qty", "quantity", "mik"],
    x: ["x", "x yonu", "en", "genislik"],
    y: ["y", "y yonu", "ic cap", "ick ap", "kalinlik"],
    z: ["z", "z yonu", "boy", "uzunluk"],
    material: ["malzeme", "seri", "alasim"],
    part: ["parca", "parca numarasi", "kod", "ref"],
    desc: ["aciklama", "not", "tanim"]
  };

  if (!keywordMap[bucket].some((token) => normalized.includes(token))) {
    return [];
  }

  const headerMatches = normalized.match(/["â€œâ€']?([a-z0-9]+(?:\s+[a-z0-9]+){0,3})["â€œâ€']?\s*(?:kolon|alan|sutun|sÃ¼tun|header|baslik|baÅŸlÄ±k)/g) ?? [];
  for (const match of headerMatches) {
    const cleaned = normalizeHeaderName(match)
      .replace(/\b(kolon|alan|sutun|sÃ¼tun|header|baslik|baÅŸlÄ±k)\b/g, "")
      .trim();
    if (cleaned) hints.push(cleaned);
  }

  const explicitTokens = normalized.match(/\b(?:qty|quantity|mik|mikt|miktar|adet|ad|x|y|z|x yonu|y yonu|z yonu|malzeme|seri|alasim|parca numarasi|kod|ref|aciklama|not|tanim)\b/g) ?? [];
  for (const token of explicitTokens) {
    if (!hints.includes(token)) hints.push(token);
  }

  return hints
    .filter(Boolean)
    .map((hint) => new RegExp(`\\b${hint.replace(/\s+/g, "\\s+")}\\b`));
}

function buildExcelDocument(workbook: XLSX.WorkBook, instruction?: string | null): ParsedOrderDocument | null {
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

    const headers = (rows[0] ?? []).map((cell) => normalizeHeaderName(cell));
    const qtyIndex = findColumnIndex(headers, [/\bmikt\b/, /\bmiktar\b/, /\bmik\b/, /\badet\b/, /\bad\b/, /\bqty\b/, /\bquantity\b/, ...buildInstructionPatterns(instruction, "qty")]);
    const xIndex = findColumnIndex(headers, [/\bx yonu\b/, /^x$/, /\ben\b/, /\bgenislik\b/, ...buildInstructionPatterns(instruction, "x")]);
    const yIndex = findColumnIndex(headers, [/\by yonu\b/, /^y$/, /\bick ap\b/, /\bic cap\b/, /\bkalinlik\b/, ...buildInstructionPatterns(instruction, "y")]);
    const zIndex = findColumnIndex(headers, [/\bz yonu\b/, /^z$/, /\bboy\b/, /\buzunluk\b/, ...buildInstructionPatterns(instruction, "z")]);
    const materialIndex = findColumnIndex(headers, [/\bmalzeme\b/, /\bseri\b/, /\balasim\b/, ...buildInstructionPatterns(instruction, "material")]);
    const partIndex = findColumnIndex(headers, [/\bparca numarasi\b/, /\bkod\b/, /\bref\b/, ...buildInstructionPatterns(instruction, "part")]);
    const descIndex = findColumnIndex(headers, [/\baciklama\b/, /\bnot\b/, /\btanim\b/, ...buildInstructionPatterns(instruction, "desc")]);

    const usableDimIndexes = [xIndex, yIndex, zIndex].filter((index) => index >= 0);
    if (usableDimIndexes.length < 2) continue;

    for (const row of rows.slice(1)) {
      const dims = usableDimIndexes
        .map((index) => toCellNumber(row[index]))
        .filter((value): value is number => value !== null);
      if (dims.length < 2) continue;

      const sortedDims = [...dims].sort((a, b) => a - b);
      const qty = qtyIndex >= 0 ? toCellNumber(row[qtyIndex]) : null;
      const material = materialIndex >= 0 ? String(row[materialIndex] ?? "").trim() : "";
      const seriesMatch = material.match(/\b([1-9]\d{3})\b/);
      const series = seriesMatch?.[1] ?? null;
      const headerParts = [
        partIndex >= 0 ? String(row[partIndex] ?? "").trim() : "",
        material,
        descIndex >= 0 ? String(row[descIndex] ?? "").trim() : ""
      ].filter(Boolean);
      const headerContext = [headerParts.join(" | "), instruction].filter(Boolean).join(" | ") || sheetName;
      const raw = [
        qty ? `${qty} ADET` : "",
        xIndex >= 0 ? `X ${row[xIndex] ?? ""}` : "",
        yIndex >= 0 ? `Y ${row[yIndex] ?? ""}` : "",
        zIndex >= 0 ? `Z ${row[zIndex] ?? ""}` : "",
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
  const parserConfidence = items.length > 0
    ? Number((items.reduce((sum, item) => sum + item.confidence, 0) / items.length).toFixed(3))
    : 0;

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
    let parsed = annotateMethod(parseOrderDocument(normalizedText, "plain_text"), "plain_text");
    if (effectiveInstruction && parsed.items.length === 0) {
      const llm = await extractWithLlmFallback(normalizedText, "plain_text", effectiveInstruction);
      if (llm.doc) parsed = llm.doc;
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
    const excelDoc = buildExcelDocument(workbook, effectiveInstruction);
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
    const expectedItemCount = parseExpectedItemCount(effectiveInstruction);
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
        item_count: parsed.items.length,
        expected_item_count: expectedItemCount,
        candidate_line_count: candidateLineCount,
        vision_error: extracted.errors.vision_error,
        llm_text_error: llmTextError,
        llm_image_error: llmImageError,
        ocr_error: extracted.errors.ocr_error
      }
    };
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

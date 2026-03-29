import { createHash } from "node:crypto";
import { matchPool } from "@smp/db";
import { ParsedOrderDocument } from "@smp/common";

export interface ExtractionFingerprint {
  sourceType: ParsedOrderDocument["source_type"];
  text: string;
  json: Record<string, unknown>;
  hash: string;
}

export interface ExtractionProfileMatch {
  id: number;
  name: string;
  instruction_text: string;
  match_instruction: string | null;
  similarity: number;
  success_count: number;
  use_count: number;
}

function normalizeToken(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stableJson(input: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(input).sort().reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = input[key];
    return acc;
  }, {});
}

export function buildFingerprint(args: {
  sourceType: ParsedOrderDocument["source_type"];
  fileName?: string;
  mimeType?: string;
  headers?: string[];
  sheetNames?: string[];
  sampleText?: string;
}): ExtractionFingerprint {
  const normalizedHeaders = (args.headers ?? []).map((header) => normalizeToken(header)).filter(Boolean);
  const normalizedSheets = (args.sheetNames ?? []).map((sheet) => normalizeToken(sheet)).filter(Boolean);
  const normalizedSample = normalizeToken(args.sampleText ?? "").split(" ").slice(0, 40).join(" ");
  const normalizedMime = normalizeToken(args.mimeType ?? "");

  const json = stableJson({
    source_type: args.sourceType,
    mime_type: normalizedMime,
    headers: normalizedHeaders,
    sheet_names: normalizedSheets,
    sample: normalizedSample
  });

  const text = [
    `source:${args.sourceType}`,
    normalizedMime ? `mime:${normalizedMime}` : "",
    normalizedSheets.length ? `sheets:${normalizedSheets.join(" | ")}` : "",
    normalizedHeaders.length ? `headers:${normalizedHeaders.join(" | ")}` : "",
    normalizedSample ? `sample:${normalizedSample}` : ""
  ].filter(Boolean).join(" || ");

  return {
    sourceType: args.sourceType,
    text,
    json,
    hash: createHash("sha256").update(text).digest("hex")
  };
}

export async function findBestExtractionProfile(fingerprint: ExtractionFingerprint): Promise<ExtractionProfileMatch | null> {
  const res = await matchPool.query<ExtractionProfileMatch & { id: string; success_count: string; use_count: string }>(
    `SELECT
       id::text,
       name,
       instruction_text,
       profile_json->>'match_instruction' AS match_instruction,
       similarity(fingerprint_text, $1) AS similarity,
       success_count::text,
       use_count::text
     FROM extraction_profiles
     WHERE active = TRUE
       AND source_type = $2
       AND similarity(fingerprint_text, $1) >= 0.18
     ORDER BY (similarity(fingerprint_text, $1) + LEAST(success_count, 20) * 0.02 + LEAST(use_count, 40) * 0.01) DESC
     LIMIT 1`,
    [fingerprint.text, fingerprint.sourceType]
  );

  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  return {
    id: Number(row.id),
    name: row.name,
    instruction_text: row.instruction_text,
    match_instruction: row.match_instruction ?? null,
    similarity: Number(row.similarity),
    success_count: Number(row.success_count),
    use_count: Number(row.use_count)
  };
}

export async function saveExtractionProfile(input: {
  name: string;
  instructionText: string;
  matchInstruction?: string | null;
  fingerprint: ExtractionFingerprint;
  extractedDoc: ParsedOrderDocument;
  sampleName?: string | null;
}): Promise<{ profileId: number }> {
  const profileInsert = await matchPool.query<{ id: string }>(
    `INSERT INTO extraction_profiles(name, source_type, fingerprint_text, fingerprint_json, instruction_text, profile_json)
     VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb)
     RETURNING id`,
    [
      input.name,
      input.fingerprint.sourceType,
      input.fingerprint.text,
      JSON.stringify(input.fingerprint.json),
      input.instructionText,
      JSON.stringify({
        extraction_method: input.extractedDoc.extraction_method ?? null,
        parser_confidence: input.extractedDoc.parser_confidence,
        match_instruction: input.matchInstruction ?? null
      })
    ]
  );

  const profileId = Number(profileInsert.rows[0].id);
  await matchPool.query(
    `INSERT INTO extraction_profile_examples(profile_id, sample_name, fingerprint_json, instruction_text, extracted_json, confirmed_json)
     VALUES($1,$2,$3::jsonb,$4,$5::jsonb,$6::jsonb)`,
    [
      profileId,
      input.sampleName ?? null,
      JSON.stringify(input.fingerprint.json),
      input.instructionText,
      JSON.stringify(input.extractedDoc),
      JSON.stringify(input.extractedDoc.items)
    ]
  );

  return { profileId };
}

export async function recordExtractionFeedback(input: {
  profileId?: number | null;
  fingerprint: ExtractionFingerprint;
  userInstruction?: string | null;
  effectiveInstruction?: string | null;
  extractedDoc: ParsedOrderDocument;
  approved: boolean;
}): Promise<void> {
  await matchPool.query(
    `INSERT INTO extraction_feedback(profile_id, source_type, fingerprint_text, fingerprint_json, user_instruction, effective_instruction, extracted_json, confirmed_json, approved)
     VALUES($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8::jsonb,$9)`,
    [
      input.profileId ?? null,
      input.fingerprint.sourceType,
      input.fingerprint.text,
      JSON.stringify(input.fingerprint.json),
      input.userInstruction ?? null,
      input.effectiveInstruction ?? null,
      JSON.stringify(input.extractedDoc),
      JSON.stringify(input.extractedDoc.items),
      input.approved
    ]
  );

  if (input.profileId) {
    await matchPool.query(
      `UPDATE extraction_profiles
       SET use_count = use_count + 1,
           success_count = success_count + CASE WHEN $2 THEN 1 ELSE 0 END,
           updated_at = NOW()
       WHERE id = $1`,
      [input.profileId, input.approved]
    );
  }
}

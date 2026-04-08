import { createHash } from "node:crypto";
import { InstructionPolicyPayload, MatchPolicy, RowInstructionCommand, RowInstructionSet } from "@smp/common";
import { matchPool } from "@smp/db";
import { ExtractionFingerprint } from "./extraction-learning";

export interface ParsedInstructionPlan {
  rawMessage: string;
  sanitizedMessage: string;
  rowCommands: RowInstructionCommand[];
  ignoredRowCommands: Array<{ reason: string; rowNumber?: number }>;
  extractionPrompt: string | null;
  matchPolicy: MatchPolicy | null;
  rowDefaults: RowInstructionSet | null;
  needsReextract: boolean;
  needsRematch: boolean;
  learnable: boolean;
}

interface StoredInstructionPolicy {
  id: number;
  name: string;
  policy_json: InstructionPolicyPayload;
  similarity: number;
  success_count: number;
  use_count: number;
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/Ã„Â±/g, "i")
    .trim();
}

function normalizeJson<T extends Record<string, unknown>>(value: T): T {
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key as keyof T] = value[key] as T[keyof T];
    return acc;
  }, {} as T);
}

function hashPolicy(policy: InstructionPolicyPayload): string {
  return createHash("sha256").update(JSON.stringify(normalizeJson(policy as Record<string, unknown>))).digest("hex");
}

function extractInstructionSet(text: string): RowInstructionSet {
  const normalized = normalizeText(text);
  if (!normalized) return {};

  const set: RowInstructionSet = {};
  const kesimVarIndex = Math.max(normalized.lastIndexOf("kesim var"), normalized.lastIndexOf("kemim var"));
  const kesimYokIndex = Math.max(normalized.lastIndexOf("kesim yok"), normalized.lastIndexOf("kemim yok"));
  if (kesimVarIndex >= 0 || kesimYokIndex >= 0) {
    set.kesimDurumu = kesimYokIndex > kesimVarIndex ? "Kesim Yok" : "Kesim Var";
  }

  if (normalized.includes("yerli")) {
    set.mensei = "YERLİ";
  } else if (normalized.includes("ithal")) {
    set.mensei = "İTHAL";
  }

  const adetMatch = normalized.match(/adet\s*(?:=|:)?\s*(\d+)/i) || normalized.match(/(\d+)\s*adet/i);
  if (adetMatch) {
    const quantity = Number(adetMatch[1]);
    if (Number.isFinite(quantity) && quantity > 0) {
      set.quantity = quantity;
    }
  }

  return set;
}

function parseRowCommands(message: string, rowCount: number): {
  commands: RowInstructionCommand[];
  ignored: Array<{ reason: string; rowNumber?: number }>;
} {
  const normalized = normalizeText(message);
  if (!normalized) {
    return { commands: [], ignored: [] };
  }

  const rowRefPattern = /(\d+)\.\s*sat[Ä±i]r(?:Ä±|i|a|e|da|de|daki|deki|icin|iÃ§in)?/g;
  const rowRefs = [...normalized.matchAll(rowRefPattern)];
  const commands: RowInstructionCommand[] = [];
  const ignored: Array<{ reason: string; rowNumber?: number }> = [];

  if (rowRefs.length === 0) {
    const globalSet = extractInstructionSet(normalized);
    if (Object.keys(globalSet).length > 0) {
      commands.push({ scope: "all", set: globalSet });
    }
    return { commands, ignored };
  }

  const segments: Array<[number, number]> = [];
  rowRefs.forEach((match, index) => {
    const rowIndex = Number(match[1]) - 1;
    const clauseStart = (match.index ?? 0) + match[0].length;
    const clauseEnd = index + 1 < rowRefs.length ? (rowRefs[index + 1].index ?? normalized.length) : normalized.length;
    const clause = normalized.slice(clauseStart, clauseEnd).trim();
    const set = extractInstructionSet(clause);

    if (!Object.keys(set).length) {
      ignored.push({ reason: "empty", rowNumber: rowIndex + 1 });
    } else if (rowIndex < 0 || rowIndex >= rowCount) {
      ignored.push({ reason: "row-out-of-range", rowNumber: rowIndex + 1 });
    } else {
      commands.push({
        scope: "row",
        rowIndex,
        rowNumber: rowIndex + 1,
        set
      });
    }

    segments.push([match.index ?? 0, clauseEnd]);
  });

  let remaining = normalized;
  segments.sort((a, b) => b[0] - a[0]).forEach(([start, end]) => {
    remaining = `${remaining.slice(0, start)} ${remaining.slice(end)}`;
  });

  const globalSet = extractInstructionSet(remaining);
  if (Object.keys(globalSet).length > 0) {
    commands.unshift({ scope: "all", set: globalSet });
  }

  return { commands, ignored };
}

export function parseMatchPolicy(instruction: string | undefined | null): MatchPolicy | null {
  const normalized = normalizeText(instruction ?? "");
  if (!normalized) return null;

  const prefixMatch = normalized.match(/\b([a-z0-9._-]{2,12})\s+ile baslayan(?:\s+stok(?:lar|lari|larda)?)?(?:\s+(?:ara|getir|goster|esle|eşle))?\b/)
    || normalized.match(/\bstok\s*kod(?:u|unda)?\s+([a-z0-9._-]{2,12})\s+ile baslayan(?:larda|lar|lari)?(?:\s+(?:ara|getir|goster|esle|eşle))?\b/i);
  const seriesPatterns = [
    /\b([1-9]\d{3})\s+(?:gecen|serisini|serisi|seri)\b/,
    /\b([1-9]\d{3})\s+serisinde\b/,
    /\b([1-9]\d{3})\s+serisinde\s+(?:ara|getir|goster)\b/,
    /\b([1-9]\d{3})\s+serisine\b/,
    /\b([1-9]\d{3})\s+serisine\s+(?:bak|gore|gÃ¶re)\b/,
    /\b(?:alasim|alaÅŸim)\s+([1-9]\d{3})\b/,
    /\b([1-9]\d{3})\s+(?:lerde|larda|olanlar|olanlari|olanlarÄ±)\b/,
    /\bsadece\s+([1-9]\d{3})\s+stoklarda\b/,
    /\b([1-9]\d{3})\s+(?:stoklarda|stoklarda ara|lerde ara|larda ara)\b/,
    /\b([1-9]\d{3})\s+(?:icin|iÃ§in)\s+ara\b/,
    /\b([1-9]\d{3})\s+(?:getir|ara|goster|gÃ¶ster)\b/
  ];
  const seriesMatch = seriesPatterns.map((pattern) => normalized.match(pattern)).find(Boolean) ?? null;
  const temperPatterns = [
    /\btamper\s*(?:=|:)?\s*(t\d{1,4}|h\d{1,4}|o|f)\b/i,
    /\btamperi?\s*(?:=|:)?\s*(t\d{1,4}|h\d{1,4}|o|f)\b/i,
    /\b(t\d{1,4}|h\d{1,4}|o|f)\s+(?:temperde|tempere|temper|durumunda)\b/i,
    /\btemper\s+(t\d{1,4}|h\d{1,4}|o|f)\b/i,
    /\btemperi?\s+(t\d{1,4}|h\d{1,4}|o|f)\b/i,
    /\b(t\d{1,4}|h\d{1,4}|o|f)\s+tamper\b/i,
    /\b(t\d{1,4}|h\d{1,4}|o|f)\s+(?:olanlar|olanlari|olanlarÄ±|getir|ara)\b/i
  ];
  const temperMatch = temperPatterns.map((pattern) => normalized.match(pattern)).find(Boolean) ?? null;
  const dim1Match = normalized.match(/\b(?:kalinlik|kalÄ±nlÄ±k)\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)\b/i);
  const dim2Match = normalized.match(/\ben\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)\b/i);
  const dim3Match = normalized.match(/\bboy\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)\b/i);
  const stockCodeContainsMatch = normalized.match(/\bstok\s*kod(?:u|unda)?\s+([a-z0-9._-]{2,30})\s+(?:gecen|geçen|gecsin|geçsin|olsun)(?:lerde|larda)?\b/i)
    || normalized.match(/\b([a-z0-9._-]{2,30})\s+(?:gecen|geçen|gecsin|geçsin)(?:lerde|larda)?\s+stok\s*kod(?:u|unda)?\b/i);
  const stockNameContainsMatch = normalized.match(/\bstok\s*ad(?:i|ı|inda|ında)?\s+(.+?)\s+(?:gecen|geçen|gecsin|geçsin|olsun)(?:lerde|larda)?\b/i)
    || normalized.match(/\b(.+?)\s+(?:gecen|geçen|gecsin|geçsin)(?:lerde|larda)?\s+stok\s*ad(?:i|ı|inda|ında)?\b/i);
  const stockCodeActionMatch = normalized.match(/\bstok\s*kod(?:u|unda)?\s+([a-z0-9._-]{2,30})\s+(?:gecsin|geçsin|olsun)\b/i);
  const stockNameActionMatch = normalized.match(/\bstok\s*ad(?:i|ı|inda|ında)?\s+(.+?)\s+(?:gecsin|geçsin|olsun)\b/i);
  const productTypePatterns: Array<{ pattern: RegExp; value: string }> = [
    { pattern: /\bboru\b/, value: "BORU" },
    { pattern: /\bprofil\b/, value: "PROFIL" },
    { pattern: /\blama\b/, value: "LAMA" },
    { pattern: /\bsac\b/, value: "SAC" },
    { pattern: /\bkosebent\b|\bkÃ¶ÅŸebent\b/, value: "KOSEBENT" },
    { pattern: /\bmil\b/, value: "MIL" },
    { pattern: /\bplaka\b/, value: "PLAKA" }
  ];
  const preferredProductType = productTypePatterns.find((item) => item.pattern.test(normalized))?.value ?? null;
  const quotedTerms = [...normalized.matchAll(/["Ã¢â‚¬Å“Ã¢â‚¬Â']([^"Ã¢â‚¬Å“Ã¢â‚¬Â']{2,40})["Ã¢â‚¬Å“Ã¢â‚¬Â']/g)].map((match) => match[1].trim());
  const genericTerms = [...normalized.matchAll(/\b([a-z0-9._-]{2,20})\s+gecen stok/g)].map((match) => match[1].trim());
  const requiredTerms = [...new Set([...quotedTerms, ...genericTerms].filter(Boolean))];
  const requiredStockCodeTerms = (stockCodeContainsMatch?.[1] || stockCodeActionMatch?.[1])
    ? [String(stockCodeContainsMatch?.[1] || stockCodeActionMatch?.[1]).trim().toUpperCase()]
    : [];
  const requiredStockNameTerms = (stockNameContainsMatch?.[1] || stockNameActionMatch?.[1])
    ? String(stockNameContainsMatch?.[1] || stockNameActionMatch?.[1]).trim().split(/\s+/).filter((term) => term.length >= 2)
    : [];
  const requiredNonEmptyFields = [
    /\btamper\s+bos\s+olamaz\b/i.test(normalized) || /\btemper\s+bos\s+olamaz\b/i.test(normalized) ? "temper" : null,
    /\balasim\s+bos\s+olamaz\b/i.test(normalized) || /\balaÅŸim\s+bos\s+olamaz\b/i.test(normalized) ? "alasim" : null,
    /\bstok\s*kodu\s+bos\s+olamaz\b/i.test(normalized) ? "stock_code" : null,
    /\bstok\s*adi\s+bos\s+olamaz\b/i.test(normalized) || /\bstok\s*adÄ±\s+bos\s+olamaz\b/i.test(normalized) ? "stock_name" : null,
    /\bkalinlik\s+bos\s+olamaz\b/i.test(normalized) || /\bkalÄ±nlÄ±k\s+bos\s+olamaz\b/i.test(normalized) ? "dim1" : null,
    /\ben\s+bos\s+olamaz\b/i.test(normalized) ? "dim2" : null,
    /\bboy\s+bos\s+olamaz\b/i.test(normalized) ? "dim3" : null
  ].filter((value): value is string => Boolean(value));

  const policy: MatchPolicy = {
    stockCodePrefix: prefixMatch?.[1]?.toUpperCase() ?? null,
    requiredTerms,
    requiredStockCodeTerms,
    requiredStockNameTerms,
    requiredNonEmptyFields,
    preferredSeries: seriesMatch?.[1] ?? null,
    preferredTemper: temperMatch?.[1]?.toUpperCase() ?? null,
    preferredProductType,
    preferredDim1: dim1Match ? Number(dim1Match[1].replace(',', '.')) : null,
    preferredDim2: dim2Match ? Number(dim2Match[1].replace(',', '.')) : null,
    preferredDim3: dim3Match ? Number(dim3Match[1].replace(',', '.')) : null
  };

  if (!policy.stockCodePrefix
    && !policy.preferredSeries
    && !policy.preferredTemper
    && !policy.preferredProductType
    && policy.preferredDim1 == null
    && policy.preferredDim2 == null
    && policy.preferredDim3 == null
    && requiredTerms.length === 0
    && requiredStockCodeTerms.length === 0
    && requiredStockNameTerms.length === 0
    && requiredNonEmptyFields.length === 0) {
    return null;
  }

  return policy;
}

function parseExpectedItemCount(message: string): number | null {
  const match = message.match(/(\d{1,2})\s*(?:satir|satÄ±r|olcu|Ã¶lÃ§Ã¼|kalem)/i);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isFinite(count) && count > 0 ? count : null;
}

export function planInstructionMessage(args: {
  message: string;
  rowCount: number;
  sourceMode: string;
}): ParsedInstructionPlan {
  const sanitizedMessage = String(args.message ?? "").trim();
  const { commands, ignored } = parseRowCommands(sanitizedMessage, args.rowCount);
  const matchPolicy = parseMatchPolicy(sanitizedMessage);
  const expectedItemCount = parseExpectedItemCount(sanitizedMessage);
  const rowDefaults = commands.find((command) => command.scope === "all")?.set ?? null;

  const extractionPrompt = expectedItemCount ? sanitizedMessage : null;

  const needsRematch = Boolean(matchPolicy) || Boolean(extractionPrompt);
  const needsReextract = Boolean(extractionPrompt) && args.sourceMode !== "text";
  const learnable = Boolean(matchPolicy || expectedItemCount || (rowDefaults && (rowDefaults.kesimDurumu || rowDefaults.mensei)));

  return {
    rawMessage: sanitizedMessage,
    sanitizedMessage,
    rowCommands: commands,
    ignoredRowCommands: ignored,
    extractionPrompt,
    matchPolicy,
    rowDefaults,
    needsReextract,
    needsRematch,
    learnable
  };
}

export async function findBestInstructionPolicy(fingerprint: ExtractionFingerprint): Promise<StoredInstructionPolicy | null> {
  const res = await matchPool.query<StoredInstructionPolicy & {
    id: string;
    success_count: string;
    use_count: string;
    policy_json: string;
  }>(
    `SELECT
       id::text,
       name,
       policy_json::text,
       similarity(fingerprint_text, $1) AS similarity,
       success_count::text,
       use_count::text
     FROM instruction_policies
     WHERE active = TRUE
       AND success_count >= 2
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
    policy_json: JSON.parse(row.policy_json) as InstructionPolicyPayload,
    similarity: Number(row.similarity),
    success_count: Number(row.success_count),
    use_count: Number(row.use_count)
  };
}

export async function commitInstructionPolicy(input: {
  fingerprint: ExtractionFingerprint;
  sourceName?: string | null;
  rawMessage: string;
  plan: ParsedInstructionPlan;
  approved: boolean;
}): Promise<{ policyId: number | null; activated: boolean }> {
  const policy: InstructionPolicyPayload = {
    extractionPrompt: input.plan.extractionPrompt,
    matchPolicy: input.plan.matchPolicy,
    rowDefaults: input.plan.rowDefaults
      ? {
        kesimDurumu: input.plan.rowDefaults.kesimDurumu,
        mensei: input.plan.rowDefaults.mensei
      }
      : null
  };

  if (!policy.extractionPrompt && !policy.matchPolicy && !policy.rowDefaults) {
    await matchPool.query(
      `INSERT INTO instruction_policy_events(source_type, fingerprint_text, fingerprint_json, raw_message, parsed_json, approved)
       VALUES($1,$2,$3::jsonb,$4,$5::jsonb,$6)`,
      [
        input.fingerprint.sourceType,
        input.fingerprint.text,
        JSON.stringify(input.fingerprint.json),
        input.rawMessage,
        JSON.stringify({
          rowCommands: input.plan.rowCommands,
          ignoredRowCommands: input.plan.ignoredRowCommands
        }),
        input.approved
      ]
    );
    return { policyId: null, activated: false };
  }

  const policyHash = hashPolicy(policy);
  const existingRes = await matchPool.query<{ id: string; active: boolean; success_count: string }>(
    `SELECT id::text, active, success_count::text
     FROM instruction_policies
     WHERE source_type = $1
       AND fingerprint_hash = $2
       AND policy_hash = $3
     LIMIT 1`,
    [input.fingerprint.sourceType, input.fingerprint.hash, policyHash]
  );

  let policyId: number;
  let activated = false;

  if ((existingRes.rowCount ?? 0) > 0) {
    policyId = Number(existingRes.rows[0].id);
    const nextSuccessCount = Number(existingRes.rows[0].success_count) + (input.approved ? 1 : 0);
    activated = !existingRes.rows[0].active && nextSuccessCount >= 2;
    await matchPool.query(
      `UPDATE instruction_policies
       SET updated_at = NOW(),
           use_count = use_count + 1,
           success_count = success_count + CASE WHEN $2 THEN 1 ELSE 0 END,
           failure_count = failure_count + CASE WHEN $2 THEN 0 ELSE 1 END,
           active = CASE WHEN success_count + CASE WHEN $2 THEN 1 ELSE 0 END >= 2 THEN TRUE ELSE active END
       WHERE id = $1`,
      [policyId, input.approved]
    );
  } else {
    const insertRes = await matchPool.query<{ id: string }>(
      `INSERT INTO instruction_policies(
         name, source_type, fingerprint_text, fingerprint_hash, fingerprint_json, policy_hash, policy_json, use_count, success_count, failure_count, active
       ) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,1,$8,$9,$10)
       RETURNING id`,
      [
        input.sourceName?.trim() || "chat-policy",
        input.fingerprint.sourceType,
        input.fingerprint.text,
        input.fingerprint.hash,
        JSON.stringify(input.fingerprint.json),
        policyHash,
        JSON.stringify(policy),
        input.approved ? 1 : 0,
        input.approved ? 0 : 1,
        input.approved ? false : false
      ]
    );
    policyId = Number(insertRes.rows[0].id);
  }

  await matchPool.query(
    `INSERT INTO instruction_policy_events(policy_id, source_type, fingerprint_text, fingerprint_json, raw_message, parsed_json, approved)
     VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7)`,
    [
      policyId,
      input.fingerprint.sourceType,
      input.fingerprint.text,
      JSON.stringify(input.fingerprint.json),
      input.rawMessage,
      JSON.stringify({
        rowCommands: input.plan.rowCommands,
        ignoredRowCommands: input.plan.ignoredRowCommands,
        policy
      }),
      input.approved
    ]
  );

  return { policyId, activated };
}



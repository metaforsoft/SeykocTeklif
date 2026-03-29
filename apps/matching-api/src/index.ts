import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { extractFeaturesFromInput, MatchInput, CandidateRow, ParsedOrderDocument, ScoredResult, scoreCandidates as baseScoreCandidates } from "@smp/common";
import { env, matchPool } from "@smp/db";
import { getModelStatus, retrainModelFromHistory } from "./ml";
import { rerankResults } from "./rerank";
import { extractSourceDocument } from "./source-extract";
import { recordExtractionFeedback, saveExtractionProfile } from "./extraction-learning";

const app = Fastify({ logger: true });

interface MatchGuidance {
  stockCodePrefix: string | null;
  requiredTerms: string[];
  preferredSeries: string | null;
}

interface OfferHeaderInput {
  isyeriKodu: string;
  belgeTarihi: string;
  cariKodu: string;
  paraBirimi: string;
  paraKurTipi?: string | null;
  paraKur?: number | null;
  teslimOdemeSekli: string;
  nakliyeSekli: string;
}

interface OfferLineInput {
  matchHistoryId: number;
  selected_stock_id: number;
  quantity: number;
  tip?: string | null;
  isyeriDepoKodu?: string | null;
  stockCode?: string | null;
  stockName?: string | null;
  boy?: number | null;
  kalinlikCap?: number | null;
  enEtKal?: number | null;
  manuelStockAdi?: string | null;
  userNote?: string | null;
}

interface OfferSaveBody {
  draftId?: number;
  header: OfferHeaderInput;
  lines: OfferLineInput[];
  customer_ref?: string;
}

function normalizeGuidanceText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .trim();
}

function parseMatchGuidance(instruction: string | undefined): MatchGuidance {
  const normalized = normalizeGuidanceText(instruction ?? "");
  if (!normalized) {
    return {
      stockCodePrefix: null,
      requiredTerms: [],
      preferredSeries: null
    };
  }

  const prefixMatch = normalized.match(/\b([a-z0-9._-]{2,12})\s+ile baslayan stok/);
  const seriesMatch = normalized.match(/\b([1-9]\d{3})\s+gecen stok/);
  const quotedTerms = [...normalized.matchAll(/["“”']([^"“”']{2,40})["“”']/g)].map((match) => match[1].trim());
  const genericTerms = [...normalized.matchAll(/\b([a-z0-9._-]{2,20})\s+gecen stok/g)].map((match) => match[1].trim());
  const requiredTerms = [...new Set([...quotedTerms, ...genericTerms].filter(Boolean))];

  return {
    stockCodePrefix: prefixMatch?.[1]?.toUpperCase() ?? null,
    requiredTerms,
    preferredSeries: seriesMatch?.[1] ?? null
  };
}

async function buildLearningBoostMap(extracted: {
  series: string | null;
  dim_text: string | null;
}): Promise<Map<number, number>> {
  const res = await matchPool.query<{ stock_id: number; hit_count: string }>(
    `SELECT selected_stock_id AS stock_id, COUNT(*)::text AS hit_count
     FROM match_history
     WHERE selected_stock_id IS NOT NULL
       AND COALESCE(extracted_json->>'series', '') = COALESCE($1, '')
       AND COALESCE(extracted_json->>'dim_text', '') = COALESCE($2, '')
     GROUP BY selected_stock_id`,
    [extracted.series, extracted.dim_text]
  );

  const map = new Map<number, number>();
  for (const row of res.rows) {
    const count = Number(row.hit_count);
    if (!Number.isFinite(count) || count <= 0) continue;
    const boost = Math.min(24, Math.log1p(count) * 8);
    map.set(Number(row.stock_id), Number(boost.toFixed(3)));
  }
  return map;
}

function applyLearningBoost(results: ScoredResult[], boostMap: Map<number, number>, topK: number): ScoredResult[] {
  const reranked = results.map((r) => {
    const boost = boostMap.get(Number(r.stock_id)) ?? 0;
    if (boost <= 0) return r;
    return {
      ...r,
      score: Number((r.score + boost).toFixed(3)),
      why: [...r.why, `ogrenilen tercih +${boost.toFixed(2)}`]
    };
  });

  return reranked.sort((a, b) => b.score - a.score).slice(0, topK);
}

function applyGuidanceFilters(candidates: CandidateRow[], guidance: MatchGuidance): CandidateRow[] {
  return candidates.filter((candidate) => {
    if (guidance.stockCodePrefix) {
      const stockCode = (candidate.stock_code ?? "").toUpperCase();
      if (!stockCode.startsWith(guidance.stockCodePrefix)) {
        return false;
      }
    }

    if (guidance.requiredTerms.length > 0) {
      const haystack = `${candidate.stock_code ?? ""} ${candidate.stock_name ?? ""}`.toLocaleLowerCase("tr-TR");
      if (!guidance.requiredTerms.every((term) => haystack.includes(term.toLocaleLowerCase("tr-TR")))) {
        return false;
      }
    }

    if (guidance.preferredSeries && candidate.series && candidate.series !== guidance.preferredSeries) {
      return false;
    }

    return true;
  });
}

function applyGuidanceBoost(results: ScoredResult[], candidates: CandidateRow[], guidance: MatchGuidance): ScoredResult[] {
  if (!guidance.stockCodePrefix && guidance.requiredTerms.length === 0 && !guidance.preferredSeries) {
    return results;
  }

  const candidateMap = new Map(candidates.map((candidate) => [Number(candidate.stock_id), candidate]));
  return results.map((result) => {
    const candidate = candidateMap.get(Number(result.stock_id));
    if (!candidate) return result;

    let score = result.score;
    const why = [...result.why];

    if (guidance.stockCodePrefix && (candidate.stock_code ?? "").toUpperCase().startsWith(guidance.stockCodePrefix)) {
      score += 18;
      why.push(`instruction prefix ${guidance.stockCodePrefix}`);
    }

    if (guidance.preferredSeries && candidate.series === guidance.preferredSeries) {
      score += 16;
      why.push(`instruction series ${guidance.preferredSeries}`);
    }

    if (guidance.requiredTerms.length > 0) {
      const haystack = `${candidate.stock_code ?? ""} ${candidate.stock_name ?? ""}`.toLocaleLowerCase("tr-TR");
      const matchedTerms = guidance.requiredTerms.filter((term) => haystack.includes(term.toLocaleLowerCase("tr-TR")));
      if (matchedTerms.length > 0) {
        score += matchedTerms.length * 10;
        why.push(`instruction terms ${matchedTerms.join(", ")}`);
      }
    }

    return {
      ...result,
      score: Number(score.toFixed(3)),
      why
    };
  }).sort((a, b) => b.score - a.score);
}

const requiredOfferHeaderFields: Array<keyof OfferHeaderInput> = [
  "isyeriKodu",
  "belgeTarihi",
  "cariKodu",
  "paraBirimi",
  "teslimOdemeSekli",
  "nakliyeSekli"
];

function validateOfferInput(header: OfferHeaderInput | undefined, lines: OfferLineInput[]): { ok: true } | { ok: false; error: string } {
  if (!header || lines.length === 0) {
    return { ok: false, error: "header ve lines gerekli" };
  }

  for (const field of requiredOfferHeaderFields) {
    const value = String(header[field] ?? "").trim();
    if (!value) {
      return { ok: false, error: `${field} gerekli` };
    }
  }

  const matchHistoryIds = [...new Set(lines.map((line) => Number(line.matchHistoryId)).filter((id) => Number.isFinite(id) && id > 0))];
  if (matchHistoryIds.length !== lines.length) {
    return { ok: false, error: "Her satirda gecerli matchHistoryId olmali" };
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const selectedStockId = Number(line.selected_stock_id);
    const quantity = Number(line.quantity);
    if (!Number.isFinite(selectedStockId) || selectedStockId <= 0) {
      return { ok: false, error: `Satir ${index + 1}: selected_stock_id gecersiz` };
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, error: `Satir ${index + 1}: quantity pozitif olmali` };
    }
  }

  return { ok: true };
}

app.register(fastifyStatic, {
  root: path.join(__dirname, "public"),
  prefix: "/ui/"
});

app.get("/", async (_request, reply) => reply.redirect("/ui/"));

app.get("/stocks", async () => {
  const res = await matchPool.query<{
    stock_id: number;
    stock_code: string | null;
    stock_name: string | null;
    stock_name2: string | null;
    description: string | null;
    category1: string | null;
    birim: string | null;
    erp_en: number | null;
    erp_boy: number | null;
    erp_yukseklik: number | null;
    erp_cap: number | null;
    product_type: string | null;
    series: string | null;
    temper: string | null;
    dim_text: string | null;
  }>(
    `SELECT
       sm.stock_id,
       sm.stock_code,
       sm.stock_name,
       sm.stock_name2,
       sm.description,
       sm.category1,
       sm.birim,
       sm.erp_en,
       sm.erp_boy,
       sm.erp_yukseklik,
       sm.erp_cap,
       sf.product_type,
       sf.series,
       sf.temper,
       sf.dim_text
     FROM stock_master sm
     LEFT JOIN stock_features sf ON sf.stock_id = sm.stock_id
     WHERE sm.is_active = TRUE
     ORDER BY COALESCE(sm.stock_code, ''), COALESCE(sm.stock_name, '')
     LIMIT 5000`
  );

  return {
    items: res.rows.map((row) => ({
      stock_id: Number(row.stock_id),
      stock_code: row.stock_code,
      stock_name: row.stock_name,
      stock_name2: row.stock_name2,
      description: row.description,
      category1: row.category1,
      birim: row.birim,
      erp_en: row.erp_en,
      erp_boy: row.erp_boy,
      erp_yukseklik: row.erp_yukseklik,
      erp_cap: row.erp_cap,
      product_type: row.product_type,
      series: row.series,
      temper: row.temper,
      dim_text: row.dim_text
    }))
  };
});

app.post<{
  Body: {
    rawText?: string;
    fileName?: string;
    mimeType?: string;
    contentBase64?: string;
    forceAiFallback?: boolean;
    userInstruction?: string;
  };
}>("/extract-source", async (request) => {
  const doc = await extractSourceDocument(request.body ?? {});
  request.log.info({
    sourceType: doc.source_type,
    method: doc.extraction_method,
    requestedMode: doc.debug?.requested_mode ?? null,
    aiForced: doc.debug?.ai_forced ?? false,
    parserConfidence: doc.parser_confidence,
    itemCount: doc.items.length,
    fallbackAttempted: doc.debug?.fallback_attempted ?? false,
    fallbackSucceeded: doc.debug?.fallback_succeeded ?? false,
    rawPreview: doc.debug?.raw_text_preview ?? "",
    visionError: doc.debug?.vision_error ?? null,
    llmTextError: doc.debug?.llm_text_error ?? null,
    llmImageError: doc.debug?.llm_image_error ?? null,
    ocrError: doc.debug?.ocr_error ?? null
  }, "source extracted");
  return doc;
});

app.post<{
  Body: {
    profileName: string;
    userInstruction: string;
    matchInstruction?: string;
    extractedDoc: ParsedOrderDocument;
    sampleName?: string;
  };
}>("/profiles/save", async (request, reply) => {
  const profileName = request.body?.profileName?.trim() ?? "";
  const userInstruction = request.body?.userInstruction?.trim() ?? "";
  const matchInstruction = request.body?.matchInstruction?.trim() || null;
  const extractedDoc = request.body?.extractedDoc;

  if (!profileName || !userInstruction || !extractedDoc?.learning?.fingerprint_text || !extractedDoc.learning.fingerprint_json) {
    return reply.code(400).send({ error: "profileName, userInstruction ve extraction metadata gerekli" });
  }

  const saved = await saveExtractionProfile({
    name: profileName,
    instructionText: userInstruction,
    matchInstruction,
    fingerprint: {
      sourceType: extractedDoc.source_type,
      text: extractedDoc.learning.fingerprint_text,
      json: extractedDoc.learning.fingerprint_json,
      hash: ""
    },
    extractedDoc,
    sampleName: request.body?.sampleName?.trim() || null
  });

  return { ok: true, profileId: saved.profileId };
});

app.post<{
  Body: {
    extractedDoc: ParsedOrderDocument;
    approved?: boolean;
  };
}>("/profiles/confirm", async (request, reply) => {
  const extractedDoc = request.body?.extractedDoc;
  if (!extractedDoc?.learning?.fingerprint_text || !extractedDoc.learning.fingerprint_json) {
    return reply.code(400).send({ error: "extractedDoc learning metadata gerekli" });
  }

  await recordExtractionFeedback({
    profileId: extractedDoc.learning.applied_profile_id ?? null,
    fingerprint: {
      sourceType: extractedDoc.source_type,
      text: extractedDoc.learning.fingerprint_text,
      json: extractedDoc.learning.fingerprint_json,
      hash: ""
    },
    userInstruction: extractedDoc.learning.user_instruction ?? null,
    effectiveInstruction: extractedDoc.learning.effective_instruction ?? null,
    extractedDoc,
    approved: request.body?.approved !== false
  });

  return { ok: true };
});

app.post<{ Body: MatchInput }>("/match", async (request, reply) => {
  const text = request.body?.text?.trim() ?? "";
  const topK = Math.max(1, Math.min(20, request.body?.topK ?? 5));

  if (!text) {
    return reply.code(400).send({ error: "text is required" });
  }

  const extracted = extractFeaturesFromInput(text);
  const hasInputDims = [extracted.dim1, extracted.dim2, extracted.dim3].some((n) => typeof n === "number");
  const candidateLimit = hasInputDims ? 350 : 120;
  const guidance = parseMatchGuidance(request.body?.matchInstruction);

  const conditions: string[] = ["sm.is_active = TRUE"];
  const params: unknown[] = [extracted.normalized_text];
  let idx = 2;

  const seriesFilter = request.body.filters?.series ?? extracted.series;
  const productTypeFilter = request.body.filters?.product_type ?? extracted.product_type;

  if (seriesFilter) {
    conditions.push(`(sf.series = $${idx} OR sf.series_group = $${idx + 1})`);
    params.push(seriesFilter, `${seriesFilter[0]}000`);
    idx += 2;
  } else if (extracted.series_group) {
    conditions.push(`sf.series_group = $${idx}`);
    params.push(extracted.series_group);
    idx += 1;
  }

  if (productTypeFilter) {
    conditions.push(`sf.product_type = $${idx}`);
    params.push(productTypeFilter.toUpperCase());
    idx += 1;
  }

  const buildSql = (whereSql: string) => `
    SELECT
      sm.stock_id,
      sm.stock_code,
      sm.stock_name,
      sm.birim,
      sf.product_type,
      sf.series,
      sf.series_group,
      sf.temper,
      sf.dim_text,
      sf.dim1::float8 AS dim1,
      sf.dim2::float8 AS dim2,
      sf.dim3::float8 AS dim3,
      similarity(sf.search_text, $1) AS similarity
    FROM stock_master sm
    JOIN stock_features sf ON sf.stock_id = sm.stock_id
    ${whereSql}
    ORDER BY similarity DESC
    LIMIT ${candidateLimit}
  `;

  let whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  let candidateRes = await matchPool.query<CandidateRow>(buildSql(whereSql), params);

  if (candidateRes.rows.length === 0 && conditions.length > 1) {
    whereSql = "WHERE sm.is_active = TRUE";
    candidateRes = await matchPool.query<CandidateRow>(buildSql(whereSql), [extracted.normalized_text]);
  }

  let guidedCandidates = applyGuidanceFilters(candidateRes.rows, guidance);
  if (guidedCandidates.length === 0) {
    guidedCandidates = candidateRes.rows;
  }

  const rawScored = baseScoreCandidates(extracted, guidedCandidates, guidedCandidates.length || topK);
  const guidedScored = applyGuidanceBoost(rawScored, guidedCandidates, guidance);
  const learningBoostMap = await buildLearningBoostMap({
    series: extracted.series,
    dim_text: extracted.dim_text
  });
  const boosted = applyLearningBoost(guidedScored, learningBoostMap, guidedScored.length || topK);
  const results = await rerankResults(text, boosted, topK);

  const historyRes = await matchPool.query<{ id: string }>(
    `INSERT INTO match_history(input_text, extracted_json, results_json)
     VALUES($1, $2::jsonb, $3::jsonb)
     RETURNING id`,
    [text, JSON.stringify(extracted), JSON.stringify(results)]
  );

  return {
    matchHistoryId: Number(historyRes.rows[0].id),
    extracted,
    results
  };
});

app.post<{ Body: { matchHistoryId: number; selected_stock_id: number; user_note?: string } }>("/feedback", async (request, reply) => {
  const { matchHistoryId, selected_stock_id, user_note } = request.body ?? {};
  if (!matchHistoryId || !selected_stock_id) {
    return reply.code(400).send({ error: "matchHistoryId and selected_stock_id are required" });
  }

  const res = await matchPool.query(
    `UPDATE match_history SET selected_stock_id=$1, user_note=$2 WHERE id=$3`,
    [selected_stock_id, user_note ?? null, matchHistoryId]
  );

  return { updated: res.rowCount ?? 0 };
});

app.post<{
  Body: {
    matchHistoryId: number;
    selected_stock_id: number;
    quantity?: number;
    customer_ref?: string;
    user_note?: string;
  };
}>("/orders/confirm-send", async (request, reply) => {
  const { matchHistoryId, selected_stock_id, quantity, customer_ref, user_note } = request.body ?? {};
  if (!matchHistoryId || !selected_stock_id) {
    return reply.code(400).send({ error: "matchHistoryId and selected_stock_id are required" });
  }

  const historyRes = await matchPool.query<{ input_text: string }>(
    "SELECT input_text FROM match_history WHERE id=$1",
    [matchHistoryId]
  );

  if (historyRes.rowCount === 0) {
    return reply.code(404).send({ error: "match history not found" });
  }

  await matchPool.query(
    `UPDATE match_history SET selected_stock_id=$1, user_note=COALESCE($2, user_note) WHERE id=$3`,
    [selected_stock_id, user_note ?? null, matchHistoryId]
  );

  const payload = {
    payloadType: "erp_order",
    matchHistoryId,
    selectedStockId: selected_stock_id,
    quantity: quantity ?? null,
    customerRef: customer_ref ?? null,
    userNote: user_note ?? null,
    sourceText: historyRes.rows[0].input_text,
    sentAt: new Date().toISOString()
  };

  const queueInsert = await matchPool.query<{ id: string }>(
    `INSERT INTO outbound_order_queue(match_history_id, selected_stock_id, quantity, customer_ref, source_text, payload_json, status)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,'pending')
     RETURNING id`,
    [matchHistoryId, selected_stock_id, quantity ?? null, customer_ref ?? null, historyRes.rows[0].input_text, JSON.stringify(payload)]
  );

  const queueId = Number(queueInsert.rows[0].id);

  if (!env.erpOrder.endpoint) {
    return {
      queueId,
      status: "pending",
      message: "ERP_ORDER_ENDPOINT not set. Order is queued but not sent."
    };
  }

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (env.erpOrder.apiKey) {
      headers["Authorization"] = `Bearer ${env.erpOrder.apiKey}`;
    }

    const erpRes = await fetch(env.erpOrder.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const responseText = await erpRes.text();
    const responseJson = {
      status: erpRes.status,
      ok: erpRes.ok,
      body: responseText
    };

    await matchPool.query(
      `UPDATE outbound_order_queue
       SET status=$1,
           response_json=$2::jsonb,
           sent_at=CASE WHEN $1 = 'sent' THEN NOW() ELSE sent_at END,
           error_text=$3,
           next_retry_at=CASE WHEN $1 = 'sent' THEN NULL ELSE NOW() END
       WHERE id=$4`,
      [erpRes.ok ? "sent" : "failed", JSON.stringify(responseJson), erpRes.ok ? null : `ERP HTTP ${erpRes.status}`, queueId]
    );

    return {
      queueId,
      status: erpRes.ok ? "sent" : "failed",
      erpResponse: responseJson
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await matchPool.query(
      `UPDATE outbound_order_queue
       SET status='failed', error_text=$1, next_retry_at=NOW()
       WHERE id=$2`,
      [message, queueId]
    );

    return reply.code(502).send({
      queueId,
      status: "failed",
      message
    });
  }
});

app.post<{
  Body: OfferSaveBody;
}>("/offers/save-draft", async (request, reply) => {
  const header = request.body?.header;
  const lines = Array.isArray(request.body?.lines) ? request.body.lines : [];

  const validation = validateOfferInput(header, lines);
  if (!validation.ok) {
    return reply.code(400).send({ error: validation.error });
  }
  const safeHeader = header as OfferHeaderInput;

  const client = await matchPool.connect();
  try {
    await client.query("BEGIN");

    let draftId = Number(request.body?.draftId);
    if (!Number.isFinite(draftId) || draftId <= 0) {
      const insertDraft = await client.query<{ id: string }>(
        `INSERT INTO offer_drafts(status, customer_ref, header_json, source_json)
         VALUES('draft', $1, $2::jsonb, $3::jsonb)
         RETURNING id::text`,
        [request.body?.customer_ref ?? null, JSON.stringify(safeHeader), JSON.stringify({ sourceType: "matching-api" })]
      );
      draftId = Number(insertDraft.rows[0].id);
    } else {
      const updateDraft = await client.query<{ id: string }>(
        `UPDATE offer_drafts
         SET status='draft',
             customer_ref=$2,
             header_json=$3::jsonb,
             source_json=$4::jsonb,
             updated_at=NOW()
         WHERE id=$1
         RETURNING id::text`,
        [draftId, request.body?.customer_ref ?? null, JSON.stringify(safeHeader), JSON.stringify({ sourceType: "matching-api" })]
      );
      if (updateDraft.rowCount === 0) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: `draft not found: ${draftId}` });
      }
    }

    await client.query("DELETE FROM offer_draft_lines WHERE draft_id=$1", [draftId]);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      await client.query(
        `INSERT INTO offer_draft_lines(draft_id, line_no, match_history_id, selected_stock_id, quantity, line_json, updated_at)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,NOW())`,
        [
          draftId,
          index + 1,
          Number(line.matchHistoryId) || null,
          Number(line.selected_stock_id) || null,
          Number(line.quantity) || null,
          JSON.stringify(line)
        ]
      );

      if (Number.isFinite(Number(line.matchHistoryId)) && Number.isFinite(Number(line.selected_stock_id))) {
        await client.query(
          `UPDATE match_history
           SET selected_stock_id=$1, user_note=COALESCE($2, user_note)
           WHERE id=$3`,
          [Number(line.selected_stock_id), line.userNote ?? null, Number(line.matchHistoryId)]
        );
      }
    }

    await client.query("COMMIT");

    return {
      ok: true,
      draftId,
      lineCount: lines.length
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

app.post<{
  Body: {
    draftId?: number;
    header: OfferHeaderInput;
    lines: OfferLineInput[];
    customer_ref?: string;
  };
}>("/offers/send", async (request, reply) => {
  const header = request.body?.header;
  const lines = Array.isArray(request.body?.lines) ? request.body.lines : [];

  const validation = validateOfferInput(header, lines);
  if (!validation.ok) {
    return reply.code(400).send({ error: validation.error });
  }
  const safeHeader = header as OfferHeaderInput;

  const matchHistoryIds = [...new Set(lines.map((line) => Number(line.matchHistoryId)).filter((id) => Number.isFinite(id) && id > 0))];

  const historyRes = await matchPool.query<{ id: string; input_text: string }>(
    "SELECT id::text, input_text FROM match_history WHERE id = ANY($1::bigint[])",
    [matchHistoryIds]
  );
  const historyMap = new Map<number, string>(historyRes.rows.map((row) => [Number(row.id), row.input_text]));

  const missing = matchHistoryIds.filter((id) => !historyMap.has(id));
  if (missing.length > 0) {
    return reply.code(404).send({ error: `match history not found: ${missing.join(", ")}` });
  }

  const offerGroupId = `offer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const summary = {
    offerGroupId,
    total: lines.length,
    queued: 0,
    sent: 0,
    failed: 0,
    items: [] as Array<{ queueId: number; status: "queued" | "sent" | "failed"; matchHistoryId: number; selectedStockId: number }>
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const matchHistoryId = Number(line.matchHistoryId);
    const selectedStockId = Number(line.selected_stock_id);
    const quantity = Number(line.quantity);

    const sourceText = historyMap.get(matchHistoryId) ?? "";
    await matchPool.query(
      `UPDATE match_history
       SET selected_stock_id=$1, user_note=COALESCE($2, user_note)
       WHERE id=$3`,
      [selectedStockId, line.userNote ?? null, matchHistoryId]
    );

    const payload = {
      payloadType: "erp_offer",
      offerGroupId,
      createdAt: new Date().toISOString(),
      header: {
        isyeriKodu: String(safeHeader.isyeriKodu).trim(),
        belgeTarihi: String(safeHeader.belgeTarihi).trim(),
        cariKodu: String(safeHeader.cariKodu).trim(),
        paraBirimi: String(safeHeader.paraBirimi).trim(),
        paraKurTipi: (safeHeader.paraKurTipi ?? "").toString().trim() || null,
        paraKur: safeHeader.paraKur ?? null,
        teslimOdemeSekli: String(safeHeader.teslimOdemeSekli).trim(),
        nakliyeSekli: String(safeHeader.nakliyeSekli).trim()
      },
      line: {
        siraNo: index + 1,
        tip: (line.tip ?? "").toString().trim() || null,
        isyeriDepoKodu: (line.isyeriDepoKodu ?? "").toString().trim() || null,
        stockId: selectedStockId,
        stockCode: (line.stockCode ?? "").toString().trim() || null,
        stockName: (line.stockName ?? "").toString().trim() || null,
        boy: line.boy ?? null,
        kalinlikCap: line.kalinlikCap ?? null,
        enEtKal: line.enEtKal ?? null,
        quantity,
        manuelStockAdi: (line.manuelStockAdi ?? "").toString().trim() || null
      },
      sourceText
    };

    const queueInsert = await matchPool.query<{ id: string }>(
      `INSERT INTO outbound_order_queue(match_history_id, selected_stock_id, quantity, customer_ref, source_text, payload_json, status)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,'pending')
       RETURNING id`,
      [matchHistoryId, selectedStockId, quantity, request.body?.customer_ref ?? null, sourceText, JSON.stringify(payload)]
    );

    const queueId = Number(queueInsert.rows[0].id);

    if (!env.erpOffer.endpoint) {
      summary.queued += 1;
      summary.items.push({ queueId, status: "queued", matchHistoryId, selectedStockId });
      continue;
    }

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (env.erpOffer.apiKey) {
        headers.Authorization = `Bearer ${env.erpOffer.apiKey}`;
      }

      const erpRes = await fetch(env.erpOffer.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });

      const responseText = await erpRes.text();
      const responseJson = {
        status: erpRes.status,
        ok: erpRes.ok,
        body: responseText
      };

      await matchPool.query(
        `UPDATE outbound_order_queue
         SET status=$1,
             response_json=$2::jsonb,
             sent_at=CASE WHEN $1 = 'sent' THEN NOW() ELSE sent_at END,
             error_text=$3,
             next_retry_at=CASE WHEN $1 = 'sent' THEN NULL ELSE NOW() END
         WHERE id=$4`,
        [erpRes.ok ? "sent" : "failed", JSON.stringify(responseJson), erpRes.ok ? null : `ERP HTTP ${erpRes.status}`, queueId]
      );

      if (erpRes.ok) {
        summary.sent += 1;
        summary.items.push({ queueId, status: "sent", matchHistoryId, selectedStockId });
      } else {
        summary.failed += 1;
        summary.items.push({ queueId, status: "failed", matchHistoryId, selectedStockId });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      await matchPool.query(
        `UPDATE outbound_order_queue
         SET status='failed', error_text=$1, next_retry_at=NOW()
         WHERE id=$2`,
        [message, queueId]
      );
      summary.failed += 1;
      summary.items.push({ queueId, status: "failed", matchHistoryId, selectedStockId });
    }
  }

  const draftId = Number(request.body?.draftId);
  if (Number.isFinite(draftId) && draftId > 0) {
    await matchPool.query(
      `UPDATE offer_drafts
       SET status='queued', updated_at=NOW()
       WHERE id=$1`,
      [draftId]
    );
  }

  return {
    ...summary,
    draftId: Number.isFinite(draftId) && draftId > 0 ? draftId : null
  };
});

app.get("/health", async () => ({ ok: true }));

app.get("/ml/status", async () => ({
  enabled: getModelStatus() !== null,
  model: getModelStatus(),
  rerankServiceUrl: process.env["RERANK_SERVICE_URL"] ?? null
}));

setInterval(() => {
  retrainModelFromHistory().catch((err) => app.log.error({ err }, "ml retrain failed"));
}, 5 * 60 * 1000);

app.listen({ host: "0.0.0.0", port: env.apiPort })
  .then(() => {
    app.log.info(`matching-api listening on ${env.apiPort}`);
    retrainModelFromHistory()
      .then((m) => {
        if (!m) app.log.info("ml model not ready: insufficient feedback data");
        else app.log.info({ samples: m.sampleCount, trainedAt: m.trainedAt }, "ml model trained");
      })
      .catch((err) => app.log.error({ err }, "initial ml training failed"));
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

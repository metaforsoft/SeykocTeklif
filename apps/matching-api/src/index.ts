import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { extractFeaturesFromInput, MatchInput, CandidateRow, ParsedOrderDocument, ScoredResult, scoreCandidates as baseScoreCandidates } from "@smp/common";
import { env, matchPool } from "@smp/db";
import { getModelStatus, retrainModelFromHistory } from "./ml";
import { rerankResults } from "./rerank";
import { extractSourceDocument } from "./source-extract";
import { recordExtractionFeedback, saveExtractionProfile } from "./extraction-learning";
import { authenticateCredentials, createSession, destroySession, ensureDefaultAdminUser, hashPassword, resolveRequestUser, shouldRedirectToLogin, isPublicPath } from "./auth";

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

interface MatchedOfferLineInput {
  matchHistoryId?: number | null;
  selected_stock_id?: number | null;
  selected_score?: number | null;
  quantity?: number | null;
  dimKalinlik?: number | null;
  dimEn?: number | null;
  dimBoy?: number | null;
  kesimDurumu?: string | null;
  user_note?: string | null;
  header_context?: string | null;
  isManual?: boolean;
}

interface SaveMatchedOfferBody {
  offerId?: number | null;
  title?: string | null;
  sourceName?: string | null;
  sourceType?: string | null;
  extractionMethod?: string | null;
  profileName?: string | null;
  rows: MatchedOfferLineInput[];
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

function toSafeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function upsertMatchedOffer(currentUserId: number, body: SaveMatchedOfferBody): Promise<number> {
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const client = await matchPool.connect();
  try {
    await client.query("BEGIN");

    const normalizedTitle = String(body.title ?? "").trim() || String(body.sourceName ?? "").trim() || `Teklif ${new Date().toISOString()}`;
    const lineCount = rows.length;
    let offerId = Number(body.offerId);

    if (!Number.isFinite(offerId) || offerId <= 0) {
      const insertRes = await client.query<{ id: string }>(
        `INSERT INTO matched_offers(title, source_name, source_type, extraction_method, profile_name, created_by_user_id, line_count, status)
         VALUES($1,$2,$3,$4,$5,$6,$7,'saved')
         RETURNING id::text`,
        [
          normalizedTitle,
          String(body.sourceName ?? "").trim() || null,
          String(body.sourceType ?? "").trim() || null,
          String(body.extractionMethod ?? "").trim() || null,
          String(body.profileName ?? "").trim() || null,
          currentUserId,
          lineCount
        ]
      );
      offerId = Number(insertRes.rows[0].id);
    } else {
      await client.query(
        `UPDATE matched_offers
         SET title=$2,
             source_name=$3,
             source_type=$4,
             extraction_method=$5,
             profile_name=$6,
             line_count=$7,
             updated_at=NOW()
         WHERE id=$1`,
        [
          offerId,
          normalizedTitle,
          String(body.sourceName ?? "").trim() || null,
          String(body.sourceType ?? "").trim() || null,
          String(body.extractionMethod ?? "").trim() || null,
          String(body.profileName ?? "").trim() || null,
          lineCount
        ]
      );
      await client.query("DELETE FROM matched_offer_lines WHERE matched_offer_id = $1", [offerId]);
    }

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const stockIdRaw = toSafeNumber(row.selected_stock_id);
      const stockId = stockIdRaw && stockIdRaw > 0 ? stockIdRaw : null;
      const selectedScoreRaw = toSafeNumber(row.selected_score);
      const selectedScore = stockId ? selectedScoreRaw : null;
      let stockCode: string | null = null;
      let stockName: string | null = null;
      let birim: string | null = null;

      if (stockId && stockId > 0) {
        const stockRes = await client.query<{ stock_code: string | null; stock_name: string | null; birim: string | null }>(
          "SELECT stock_code, stock_name, birim FROM stock_master WHERE stock_id = $1 LIMIT 1",
          [stockId]
        );
        if ((stockRes.rowCount ?? 0) > 0) {
          stockCode = stockRes.rows[0].stock_code;
          stockName = stockRes.rows[0].stock_name;
          birim = stockRes.rows[0].birim;
        }
      }

      await client.query(
        `INSERT INTO matched_offer_lines(
           matched_offer_id, line_no, match_history_id, selected_stock_id, stock_code, stock_name, birim,
           quantity, dim_kalinlik, dim_en, dim_boy, kesim_durumu, selected_score, is_manual, source_line_text, line_json
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,
        [
          offerId,
          index + 1,
          toSafeNumber(row.matchHistoryId),
          stockId,
          stockCode,
          stockName,
          birim,
          toSafeNumber(row.quantity),
          toSafeNumber(row.dimKalinlik),
          toSafeNumber(row.dimEn),
          toSafeNumber(row.dimBoy),
          String(row.kesimDurumu ?? "").trim() || null,
          selectedScore,
          Boolean(row.isManual),
          String(row.header_context ?? row.user_note ?? "").trim() || null,
          JSON.stringify(row)
        ]
      );
    }

    await client.query("COMMIT");
    return offerId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

app.register(fastifyStatic, {
  root: path.join(__dirname, "public"),
  prefix: "/ui/"
});

app.register(fastifyStatic, {
  root: path.join(__dirname, "public"),
  prefix: "/portal/",
  decorateReply: false
});

app.addHook("onRequest", async (request, reply) => {
  if (isPublicPath(request.url)) return;

  const authUser = await resolveRequestUser(request);
  if (authUser) return;

  if (shouldRedirectToLogin(request)) {
    return reply.redirect("/login");
  }

  return reply.code(401).send({ error: "Unauthorized" });
});

app.get("/", async (request, reply) => {
  const authUser = await resolveRequestUser(request);
  return reply.redirect(authUser ? "/app/dashboard" : "/login");
});

app.get("/login", async (_request, reply) => reply.sendFile("login.html"));
app.get("/app", async (_request, reply) => reply.redirect("/app/dashboard"));
app.get("/app/*", async (_request, reply) => reply.sendFile("app-shell.html"));

app.post<{ Body: { username?: string; password?: string } }>("/auth/login", async (request, reply) => {
  const username = String(request.body?.username ?? "").trim();
  const password = String(request.body?.password ?? "");
  if (!username || !password) {
    return reply.code(400).send({ error: "Kullanici adi ve sifre gerekli" });
  }

  const user = await authenticateCredentials(username, password);
  if (!user) {
    return reply.code(401).send({ error: "Kullanici adi veya sifre hatali" });
  }

  await createSession(reply, user.id);
  return {
    ok: true,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role
    }
  };
});

app.post("/auth/logout", async (request, reply) => {
  await destroySession(request, reply);
  return { ok: true };
});

app.get("/auth/me", async (request) => {
  const authUser = await resolveRequestUser(request);
  return { user: authUser };
});

app.get("/dashboard/summary", async (request, reply) => {
  const authUser = await resolveRequestUser(request);
  if (!authUser) return reply.code(401).send({ error: "Unauthorized" });

  const [usersRes, offersRes, recentRes, sourceRes] = await Promise.all([
    matchPool.query<{ total: string }>("SELECT COUNT(*)::text AS total FROM app_users WHERE is_active = TRUE"),
    matchPool.query<{ total: string; today: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::text AS today
       FROM matched_offers`
    ),
    matchPool.query<{ created_on: string; total: string }>(
      `SELECT TO_CHAR(created_at::date, 'YYYY-MM-DD') AS created_on, COUNT(*)::text AS total
       FROM matched_offers
       WHERE created_at >= NOW() - INTERVAL '7 days'
       GROUP BY created_at::date
       ORDER BY created_at::date`
    ),
    matchPool.query<{ source_type: string | null; total: string }>(
      `SELECT COALESCE(source_type, 'bilinmiyor') AS source_type, COUNT(*)::text AS total
       FROM matched_offers
       GROUP BY COALESCE(source_type, 'bilinmiyor')
       ORDER BY COUNT(*) DESC`
    )
  ]);

  const totalOffers = Number(offersRes.rows[0]?.total ?? 0);
  const todayOffers = Number(offersRes.rows[0]?.today ?? 0);
  const pendingOffers = Math.max(0, totalOffers - todayOffers);

  return {
    cards: {
      totalOffers,
      todayOffers,
      pendingOffers,
      totalUsers: Number(usersRes.rows[0]?.total ?? 0)
    },
    line: recentRes.rows.map((row) => ({
      label: row.created_on,
      value: Number(row.total)
    })),
    pie: sourceRes.rows.map((row) => ({
      label: row.source_type || "bilinmiyor",
      value: Number(row.total)
    })),
    bar: [
      { label: "Admin", value: authUser.role === "admin" ? Math.max(2, todayOffers) : 1 },
      { label: "User", value: Math.max(1, totalOffers - todayOffers) }
    ]
  };
});

app.get("/users", async (request, reply) => {
  const authUser = await resolveRequestUser(request);
  if (!authUser || authUser.role !== "admin") {
    return reply.code(403).send({ error: "Bu islem icin admin yetkisi gerekli" });
  }

  const res = await matchPool.query<{
    id: string;
    username: string;
    full_name: string;
    role: "admin" | "user";
    is_active: boolean;
    created_at: Date;
  }>(
    `SELECT id::text, username, full_name, role, is_active, created_at
     FROM app_users
     ORDER BY created_at DESC`
  );

  return {
    items: res.rows.map((row) => ({
      id: Number(row.id),
      username: row.username,
      fullName: row.full_name,
      role: row.role,
      isActive: row.is_active,
      createdAt: row.created_at
    }))
  };
});

app.post<{
  Body: {
    username?: string;
    password?: string;
    fullName?: string;
    role?: "admin" | "user";
    isActive?: boolean;
  };
}>("/users", async (request, reply) => {
  const authUser = await resolveRequestUser(request);
  if (!authUser || authUser.role !== "admin") {
    return reply.code(403).send({ error: "Bu islem icin admin yetkisi gerekli" });
  }

  const username = String(request.body?.username ?? "").trim();
  const password = String(request.body?.password ?? "");
  const fullName = String(request.body?.fullName ?? "").trim();
  const role = request.body?.role === "admin" ? "admin" : "user";
  const isActive = request.body?.isActive !== false;

  if (!username || !password || !fullName) {
    return reply.code(400).send({ error: "Tum alanlar zorunlu" });
  }

  const passwordHash = await hashPassword(password);
  try {
    const insertRes = await matchPool.query<{ id: string }>(
      `INSERT INTO app_users(username, password_hash, full_name, role, is_active)
       VALUES($1,$2,$3,$4,$5)
       RETURNING id::text`,
      [username, passwordHash, fullName, role, isActive]
    );
    return { ok: true, id: Number(insertRes.rows[0].id) };
  } catch (error) {
    if (String((error as { message?: string })?.message || "").includes("app_users_username_key")) {
      return reply.code(409).send({ error: "Bu kullanici adi zaten var" });
    }
    throw error;
  }
});

app.get("/matched-offers", async (request) => {
  const authUser = await resolveRequestUser(request);
  const params: unknown[] = [];
  const whereSql = authUser?.role === "admin"
    ? ""
    : "WHERE mo.created_by_user_id = $1";
  if (authUser?.role !== "admin") {
    params.push(authUser?.id ?? 0);
  }

  const res = await matchPool.query<{
    id: string;
    title: string;
    source_name: string | null;
    source_type: string | null;
    profile_name: string | null;
    line_count: string;
    status: string;
    created_at: Date;
    full_name: string | null;
  }>(
    `SELECT mo.id::text, mo.title, mo.source_name, mo.source_type, mo.profile_name,
            mo.line_count::text, mo.status, mo.created_at, u.full_name
     FROM matched_offers mo
     LEFT JOIN app_users u ON u.id = mo.created_by_user_id
     ${whereSql}
     ORDER BY mo.created_at DESC
     LIMIT 200`,
    params
  );

  return {
    items: res.rows.map((row) => ({
      id: Number(row.id),
      title: row.title,
      sourceName: row.source_name,
      sourceType: row.source_type,
      profileName: row.profile_name,
      lineCount: Number(row.line_count),
      status: row.status,
      createdAt: row.created_at,
      createdBy: row.full_name
    }))
  };
});

app.get<{ Params: { id: string } }>("/matched-offers/:id", async (request, reply) => {
  const authUser = await resolveRequestUser(request);
  const offerId = Number(request.params.id);
  if (!Number.isFinite(offerId) || offerId <= 0) {
    return reply.code(400).send({ error: "Gecersiz kayit id" });
  }

  const offerRes = await matchPool.query<{
    id: string;
    title: string;
    source_name: string | null;
    source_type: string | null;
    extraction_method: string | null;
    profile_name: string | null;
    created_by_user_id: string | null;
    created_at: Date;
  }>(
    `SELECT id::text, title, source_name, source_type, extraction_method, profile_name, created_by_user_id::text, created_at
     FROM matched_offers
     WHERE id = $1
     LIMIT 1`,
    [offerId]
  );

  if (offerRes.rowCount === 0) {
    return reply.code(404).send({ error: "Kayit bulunamadi" });
  }

  const offer = offerRes.rows[0];
  if (authUser?.role !== "admin" && Number(offer.created_by_user_id || 0) !== authUser?.id) {
    return reply.code(403).send({ error: "Bu kayda erisim yetkiniz yok" });
  }

  const linesRes = await matchPool.query<{
    line_no: number;
    match_history_id: string | null;
    selected_stock_id: number | null;
    stock_code: string | null;
    stock_name: string | null;
    birim: string | null;
    quantity: string | null;
    dim_kalinlik: string | null;
    dim_en: string | null;
    dim_boy: string | null;
    kesim_durumu: string | null;
    selected_score: string | null;
    is_manual: boolean;
  }>(
    `SELECT line_no, match_history_id::text, selected_stock_id, stock_code, stock_name, birim,
            quantity::text, dim_kalinlik::text, dim_en::text, dim_boy::text, kesim_durumu, selected_score::text, is_manual
     FROM matched_offer_lines
     WHERE matched_offer_id = $1
     ORDER BY line_no`,
    [offerId]
  );

  return {
    offer: {
      id: Number(offer.id),
      title: offer.title,
      sourceName: offer.source_name,
      sourceType: offer.source_type,
      extractionMethod: offer.extraction_method,
      profileName: offer.profile_name,
      createdAt: offer.created_at
    },
    rows: linesRes.rows.map((row) => ({
      matchHistoryId: row.match_history_id ? Number(row.match_history_id) : null,
      selected_stock_id: row.selected_stock_id && row.selected_stock_id > 0 ? row.selected_stock_id : null,
      selected_score: row.selected_stock_id && row.selected_stock_id > 0 ? toSafeNumber(row.selected_score) : null,
      quantity: toSafeNumber(row.quantity),
      dimKalinlik: toSafeNumber(row.dim_kalinlik),
      dimEn: toSafeNumber(row.dim_en),
      dimBoy: toSafeNumber(row.dim_boy),
      kesimDurumu: row.kesim_durumu,
      isManual: row.is_manual,
      stock_code: row.stock_code,
      stock_name: row.stock_name,
      birim: row.birim
    }))
  };
});

app.post<{ Body: SaveMatchedOfferBody }>("/matched-offers/save", async (request, reply) => {
  const authUser = await resolveRequestUser(request);
  if (!authUser) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  if (!Array.isArray(request.body?.rows) || request.body.rows.length === 0) {
    return reply.code(400).send({ error: "Kaydedilecek satir bulunamadi" });
  }

  const offerId = await upsertMatchedOffer(authUser.id, request.body);
  return { ok: true, offerId };
});

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
    ensureDefaultAdminUser()
      .then(() => app.log.info("default admin user verified"))
      .catch((err) => app.log.error({ err }, "default admin verification failed"));
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

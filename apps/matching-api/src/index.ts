import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import * as XLSX from "xlsx";
import { extractFeaturesFromInput, MatchInput, CandidateRow, InstructionPolicyPayload, MatchPolicy, ParsedOrderDocument, ScoredResult, scoreCandidates as baseScoreCandidates } from "@smp/common";
import { env, matchPool } from "@smp/db";
import { getModelStatus, retrainModelFromHistory } from "./ml";
import { rerankResults } from "./rerank";
import { extractSourceDocument } from "./source-extract";
import { recordExtractionFeedback, saveExtractionProfile } from "./extraction-learning";
import { commitInstructionPolicy, parseMatchPolicy, planInstructionMessage } from "./instruction-policies";
import { evaluateHardRules, MatchingRuleRecord, RuleCondition, RuleEffect } from "./rule-engine";
import { authenticateCredentials, createSession, destroySession, ensureDefaultAdminUser, hashPassword, resolveRequestUser, shouldRedirectToLogin, isPublicPath } from "./auth";
import { getLookupOptions, postUyumRequest } from "./uyum-lookups";

const app = Fastify({ logger: true });

type MatchGuidance = MatchPolicy;

interface OfferHeaderInput {
  isyeriKodu: string;
  belgeTarihi: string;
  cariKodu: string;
  paraBirimi: string;
  paraKurTipi?: string | null;
  paraKur?: number | null;
  teslimOdemeSekli: string;
  nakliyeSekli: string;
  warehouseCode?: string | null;
  paymentPlanDesc?: string | null;
  shippingDate?: string | null;
  deliveryDate?: string | null;
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
  kg?: number | null;
  talasMik?: number | null;
  musteriNo?: string | null;
  musteriParcaNo?: string | null;
  dimKalinlik?: number | null;
  dimEn?: number | null;
  dimBoy?: number | null;
  alasim?: string | null;
  tamper?: string | null;
  kesimDurumu?: string | null;
  mensei?: string | null;
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
  offerDate?: string | null;
  movementCode?: string | null;
  customerCode?: string | null;
  representativeCode?: string | null;
  warehouseCode?: string | null;
  paymentPlanCode?: string | null;
  incotermName?: string | null;
  transportTypeCode?: string | null;
  deliveryDate?: string | null;
  description?: string | null;
  rows: MatchedOfferLineInput[];
}

interface SendMatchedOfferToErpBody {
  offerId?: number | null;
  offerDate?: string | null;
  movementCode?: string | null;
  customerCode?: string | null;
  representativeCode?: string | null;
  warehouseCode?: string | null;
  paymentPlanCode?: string | null;
  incotermName?: string | null;
  transportTypeCode?: string | null;
  deliveryDate?: string | null;
  description?: string | null;
  rows: MatchedOfferLineInput[];
}

interface ExportMatchedTableRowInput {
  sira?: number | null;
  kalinlik?: number | null;
  en?: number | null;
  boy?: number | null;
  kg?: number | null;
  talasMik?: number | null;
  musteriNo?: string | null;
  musteriParcaNo?: string | null;
  alasim?: string | null;
  tamper?: string | null;
  stokKodu?: string | null;
  stokAdi?: string | null;
  birim?: string | null;
  kesimDurumu?: string | null;
  mensei?: string | null;
  adet?: number | null;
}

interface InsertOfferDetailPayload {
  lineType: string;
  DcardCode: string;
  ItemAttributeCode1?: string;
  unitId: number;
  qty: number;
  unitPriceTra: number;
  unitPrice: number;
  vatId: number;
  vatStatus: string;
  whouseId: number;
  amt: number;
  amtTra: number;
  lineNo: number;
  curTraId: number;
}

interface InsertOfferPayload {
  Value: {
    sourceApp: string;
    details: InsertOfferDetailPayload[];
    EntityCode: string;
    DocTraCode: string;
    SalesPersonCode: string;
    TransportTypeCode?: string;
    PaymentPlanCode?: string;
    ShippingDate?: string;
    DeliveryDate?: string;
    amt: number;
    curTra: number;
    curId: number;
    coId: number;
    branchId: number;
  };
}

interface InsertOfferPayloadLowercase {
  value: InsertOfferPayload["Value"];
}

function normalizeGuidanceText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/Ä±/g, "i")
    .trim();
}

function formatErpDateTime(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw;
  const [, year, month, day] = match;
  return `${Number(day)}.${month}.${year} 00:00:00`;
}

function formatOfferDateForUyum(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw;
  const [, year, month, day] = match;
  return `${month}.${day}.${year}`;
}

function parseMatchGuidance(instruction: string | undefined): MatchGuidance {
  const normalized = normalizeGuidanceText(instruction ?? "");
  if (!normalized) {
    return {
      stockCodePrefix: null,
      requiredTerms: [],
      requiredStockCodeTerms: [],
      requiredStockNameTerms: [],
      requiredNonEmptyFields: [],
      preferredSeries: null,
      preferredTemper: null,
      preferredProductType: null,
      preferredDim1: null,
      preferredDim2: null,
      preferredDim3: null
    };
  }

  const prefixMatch = normalized.match(/\b([a-z0-9._-]{2,12})\s+ile baslayan(?:\s+stok(?:lar|lari|larda)?)?(?:\s+(?:ara|getir|goster|esle|eşle))?\b/)
    || normalized.match(/\bstok\s*kod(?:u|unda)?\s+([a-z0-9._-]{2,12})\s+ile baslayan(?:larda|lar|lari)?(?:\s+(?:ara|getir|goster|esle|eşle))?\b/i);
  const seriesMatch = [
    /\b([1-9]\d{3})\s+gecen stok\b/,
    /\b([1-9]\d{3})\s+serisinde\b/,
    /\b([1-9]\d{3})\s+serisinde\s+(?:ara|getir|goster)\b/,
    /\b([1-9]\d{3})\s+serisine\b/,
    /\b([1-9]\d{3})\s+serisine\s+(?:bak|gore|gÃ¶re)\b/,
    /\b([1-9]\d{3})\s+(?:getir|ara|goster)\b/
  ].map((pattern) => normalized.match(pattern)).find(Boolean) ?? null;
  const temperMatch = [
    /\btamper\s*(?:=|:)?\s*(t\d{1,4}|h\d{1,4}|o|f)\b/i,
    /\btamperi?\s*(?:=|:)?\s*(t\d{1,4}|h\d{1,4}|o|f)\b/i,
    /\btemper\s+(t\d{1,4}|h\d{1,4}|o|f)\b/i,
    /\btemperi?\s+(t\d{1,4}|h\d{1,4}|o|f)\b/i,
    /\b(t\d{1,4}|h\d{1,4}|o|f)\s+tamper\b/i,
    /\b(t\d{1,4}|h\d{1,4}|o|f)\s+(?:olanlar|getir|ara)\b/i
  ].map((pattern) => normalized.match(pattern)).find(Boolean) ?? null;
  const dim1Match = normalized.match(/\b(?:kalinlik|kalÄ±nlÄ±k)\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)\b/i);
  const dim2Match = normalized.match(/\ben\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)\b/i);
  const dim3Match = normalized.match(/\bboy\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)\b/i);
  const stockCodeContainsMatch = normalized.match(/\bstok\s*kod(?:u|unda)?\s+([a-z0-9._-]{2,30})\s+(?:gecen|geçen|gecsin|geçsin|olsun)(?:lerde|larda)?\b/i)
    || normalized.match(/\b([a-z0-9._-]{2,30})\s+(?:gecen|geçen|gecsin|geçsin)(?:lerde|larda)?\s+stok\s*kod(?:u|unda)?\b/i);
  const stockNameContainsMatch = normalized.match(/\bstok\s*ad(?:i|ı|inda|ında)?\s+(.+?)\s+(?:gecen|geçen|gecsin|geçsin|olsun)(?:lerde|larda)?\b/i)
    || normalized.match(/\b(.+?)\s+(?:gecen|geçen|gecsin|geçsin)(?:lerde|larda)?\s+stok\s*ad(?:i|ı|inda|ında)?\b/i);
  const stockCodeActionMatch = normalized.match(/\bstok\s*kod(?:u|unda)?\s+([a-z0-9._-]{2,30})\s+(?:gecsin|geçsin|olsun)\b/i);
  const stockNameActionMatch = normalized.match(/\bstok\s*ad(?:i|ı|inda|ında)?\s+(.+?)\s+(?:gecsin|geçsin|olsun)\b/i);
  const quotedTerms = [...normalized.matchAll(/["â€œâ€']([^"â€œâ€']{2,40})["â€œâ€']/g)].map((match) => match[1].trim());
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

  return {
    stockCodePrefix: prefixMatch?.[1]?.toUpperCase() ?? null,
    requiredTerms,
    requiredStockCodeTerms,
    requiredStockNameTerms,
    requiredNonEmptyFields,
    preferredSeries: seriesMatch?.[1] ?? null,
    preferredTemper: temperMatch?.[1]?.toUpperCase() ?? null,
    preferredProductType: null,
    preferredDim1: dim1Match ? Number(dim1Match[1].replace(',', '.')) : null,
    preferredDim2: dim2Match ? Number(dim2Match[1].replace(',', '.')) : null,
    preferredDim3: dim3Match ? Number(dim3Match[1].replace(',', '.')) : null
  };
}

function buildGuidance(instruction: string | undefined, policy: MatchPolicy | null | undefined): MatchGuidance {
  const parsed = parseMatchGuidance(instruction);
  return {
    stockCodePrefix: policy?.stockCodePrefix ?? parsed.stockCodePrefix ?? null,
    requiredTerms: [...new Set([...(policy?.requiredTerms ?? []), ...(parsed.requiredTerms ?? [])])],
    requiredStockCodeTerms: [...new Set([...(policy?.requiredStockCodeTerms ?? []), ...(parsed.requiredStockCodeTerms ?? [])])],
    requiredStockNameTerms: [...new Set([...(policy?.requiredStockNameTerms ?? []), ...(parsed.requiredStockNameTerms ?? [])])],
    requiredNonEmptyFields: [...new Set([...(policy?.requiredNonEmptyFields ?? []), ...(parsed.requiredNonEmptyFields ?? [])])],
    preferredSeries: policy?.preferredSeries ?? parsed.preferredSeries ?? null,
    preferredTemper: policy?.preferredTemper ?? parsed.preferredTemper ?? null,
    preferredProductType: policy?.preferredProductType ?? parsed.preferredProductType ?? null,
    preferredDim1: policy?.preferredDim1 ?? parsed.preferredDim1 ?? null,
    preferredDim2: policy?.preferredDim2 ?? parsed.preferredDim2 ?? null,
    preferredDim3: policy?.preferredDim3 ?? parsed.preferredDim3 ?? null
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
      why: [...r.why, `ogrenilen tercih +${boost.toFixed(2)}`],
      score_breakdown: r.score_breakdown
        ? {
          ...r.score_breakdown,
          components: {
            ...r.score_breakdown.components,
            learning: r.score_breakdown.components.learning + boost
          }
        }
        : r.score_breakdown
    };
  });

  return reranked.sort((a, b) => b.score - a.score).slice(0, topK);
}

function applyGuidanceFilters(candidates: CandidateRow[], guidance: MatchGuidance): CandidateRow[] {
  const requiredTerms = guidance.requiredTerms ?? [];
  const requiredStockCodeTerms = guidance.requiredStockCodeTerms ?? [];
  const requiredStockNameTerms = guidance.requiredStockNameTerms ?? [];
  const requiredNonEmptyFields = guidance.requiredNonEmptyFields ?? [];
  return candidates.filter((candidate) => {
    if (guidance.stockCodePrefix) {
      const stockCode = (candidate.stock_code ?? "").toUpperCase();
      if (!stockCode.startsWith(guidance.stockCodePrefix)) {
        return false;
      }
    }

    if (requiredTerms.length > 0) {
      const haystack = `${candidate.stock_code ?? ""} ${candidate.stock_name ?? ""}`.toLocaleLowerCase("tr-TR");
      if (!requiredTerms.every((term) => haystack.includes(term.toLocaleLowerCase("tr-TR")))) {
        return false;
      }
    }

    if (requiredStockCodeTerms.length > 0) {
      const stockCode = (candidate.stock_code ?? "").toLocaleUpperCase("tr-TR");
      if (!requiredStockCodeTerms.every((term) => stockCode.includes(term.toLocaleUpperCase("tr-TR")))) {
        return false;
      }
    }

    if (requiredStockNameTerms.length > 0) {
      const stockName = (candidate.stock_name ?? "").toLocaleLowerCase("tr-TR");
      if (!requiredStockNameTerms.every((term) => stockName.includes(term.toLocaleLowerCase("tr-TR")))) {
        return false;
      }
    }

    if (requiredNonEmptyFields.length > 0) {
      const fieldChecks: Record<string, string | number | null | undefined> = {
        temper: candidate.temper ?? candidate.tamper,
        alasim: candidate.alasim ?? candidate.series,
        stock_code: candidate.stock_code,
        stock_name: candidate.stock_name,
        dim1: candidate.dim1 ?? candidate.erp_cap,
        dim2: candidate.dim2 ?? candidate.erp_en,
        dim3: candidate.dim3 ?? candidate.erp_boy
      };
      if (!requiredNonEmptyFields.every((field) => {
        const value = fieldChecks[field];
        return value !== null && value !== undefined && String(value).trim() !== "";
      })) {
        return false;
      }
    }

    if (guidance.preferredSeries && candidate.series && candidate.series !== guidance.preferredSeries) {
      return false;
    }

    if (guidance.preferredTemper) {
      const temper = (candidate.temper ?? candidate.tamper ?? "").toLocaleUpperCase("tr-TR");
      if (temper && temper !== guidance.preferredTemper) {
        return false;
      }
    }

    if (guidance.preferredProductType) {
      const productType = (candidate.product_type ?? candidate.cinsi ?? "").toLocaleUpperCase("tr-TR");
      if (productType && productType !== guidance.preferredProductType) {
        return false;
      }
    }

    if (guidance.preferredDim1 != null) {
      const dim1 = Number(candidate.dim1 ?? candidate.erp_cap);
      if (Number.isFinite(dim1) && Math.abs(dim1 - Number(guidance.preferredDim1)) > 0.001) {
        return false;
      }
    }

    if (guidance.preferredDim2 != null) {
      const dim2 = Number(candidate.dim2 ?? candidate.erp_en);
      if (Number.isFinite(dim2) && Math.abs(dim2 - Number(guidance.preferredDim2)) > 0.001) {
        return false;
      }
    }

    if (guidance.preferredDim3 != null) {
      const dim3 = Number(candidate.dim3 ?? candidate.erp_boy);
      if (Number.isFinite(dim3) && Math.abs(dim3 - Number(guidance.preferredDim3)) > 0.001) {
        return false;
      }
    }

    return true;
  });
}

function applyGuidanceBoost(results: ScoredResult[], candidates: CandidateRow[], guidance: MatchGuidance): ScoredResult[] {
  const requiredTerms = guidance.requiredTerms ?? [];
  const requiredStockCodeTerms = guidance.requiredStockCodeTerms ?? [];
  const requiredStockNameTerms = guidance.requiredStockNameTerms ?? [];
  const requiredNonEmptyFields = guidance.requiredNonEmptyFields ?? [];
  if (!guidance.stockCodePrefix
    && requiredTerms.length === 0
    && requiredStockCodeTerms.length === 0
    && requiredStockNameTerms.length === 0
    && requiredNonEmptyFields.length === 0
    && !guidance.preferredSeries
    && !guidance.preferredTemper
    && !guidance.preferredProductType
    && guidance.preferredDim1 == null
    && guidance.preferredDim2 == null
    && guidance.preferredDim3 == null) {
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
      if (result.score_breakdown) {
        result.score_breakdown.components.instruction += 18;
      }
    }

    if (guidance.preferredSeries && candidate.series === guidance.preferredSeries) {
      score += 16;
      why.push(`instruction series ${guidance.preferredSeries}`);
      if (result.score_breakdown) {
        result.score_breakdown.components.instruction += 16;
      }
    }

    if (guidance.preferredTemper) {
      const temper = (candidate.temper ?? candidate.tamper ?? "").toLocaleUpperCase("tr-TR");
      if (temper === guidance.preferredTemper) {
        score += 14;
        why.push(`instruction temper ${guidance.preferredTemper}`);
        if (result.score_breakdown) {
          result.score_breakdown.components.instruction += 14;
        }
      }
    }

    if (guidance.preferredProductType) {
      const productType = (candidate.product_type ?? candidate.cinsi ?? "").toLocaleUpperCase("tr-TR");
      if (productType === guidance.preferredProductType) {
        score += 12;
        why.push(`instruction type ${guidance.preferredProductType}`);
        if (result.score_breakdown) {
          result.score_breakdown.components.instruction += 12;
        }
      }
    }

    if (requiredStockCodeTerms.length > 0) {
      const stockCode = (candidate.stock_code ?? "").toLocaleUpperCase("tr-TR");
      const matchedCodeTerms = requiredStockCodeTerms.filter((term) => stockCode.includes(term.toLocaleUpperCase("tr-TR")));
      if (matchedCodeTerms.length > 0) {
        const delta = matchedCodeTerms.length * 12;
        score += delta;
        why.push(`instruction stock code ${matchedCodeTerms.join(", ")}`);
        if (result.score_breakdown) {
          result.score_breakdown.components.instruction += delta;
        }
      }
    }

    if (requiredStockNameTerms.length > 0) {
      const stockName = (candidate.stock_name ?? "").toLocaleLowerCase("tr-TR");
      const matchedNameTerms = requiredStockNameTerms.filter((term) => stockName.includes(term.toLocaleLowerCase("tr-TR")));
      if (matchedNameTerms.length > 0) {
        const delta = matchedNameTerms.length * 8;
        score += delta;
        why.push(`instruction stock name ${matchedNameTerms.join(", ")}`);
        if (result.score_breakdown) {
          result.score_breakdown.components.instruction += delta;
        }
      }
    }

    if (requiredTerms.length > 0) {
      const haystack = `${candidate.stock_code ?? ""} ${candidate.stock_name ?? ""}`.toLocaleLowerCase("tr-TR");
      const matchedTerms = requiredTerms.filter((term) => haystack.includes(term.toLocaleLowerCase("tr-TR")));
      if (matchedTerms.length > 0) {
        const delta = matchedTerms.length * 10;
        score += delta;
        why.push(`instruction terms ${matchedTerms.join(", ")}`);
        if (result.score_breakdown) {
          result.score_breakdown.components.instruction += delta;
        }
      }
    }

    if (guidance.preferredDim1 != null) {
      const dim1 = Number(candidate.dim1 ?? candidate.erp_cap);
      if (Number.isFinite(dim1) && Math.abs(dim1 - Number(guidance.preferredDim1)) <= 0.001) {
        score += 14;
        why.push(`instruction kalinlik ${guidance.preferredDim1}`);
        if (result.score_breakdown) {
          result.score_breakdown.components.instruction += 14;
        }
      }
    }

    if (guidance.preferredDim2 != null) {
      const dim2 = Number(candidate.dim2 ?? candidate.erp_en);
      if (Number.isFinite(dim2) && Math.abs(dim2 - Number(guidance.preferredDim2)) <= 0.001) {
        score += 12;
        why.push(`instruction en ${guidance.preferredDim2}`);
        if (result.score_breakdown) {
          result.score_breakdown.components.instruction += 12;
        }
      }
    }

    if (guidance.preferredDim3 != null) {
      const dim3 = Number(candidate.dim3 ?? candidate.erp_boy);
      if (Number.isFinite(dim3) && Math.abs(dim3 - Number(guidance.preferredDim3)) <= 0.001) {
        score += 12;
        why.push(`instruction boy ${guidance.preferredDim3}`);
        if (result.score_breakdown) {
          result.score_breakdown.components.instruction += 12;
        }
      }
    }

    return {
      ...result,
      score: Number(score.toFixed(3)),
      why
    };
  }).sort((a, b) => b.score - a.score);
}

async function loadActiveHardRules(): Promise<MatchingRuleRecord[]> {
  const res = await matchPool.query<{
    id: string;
    rule_set_id: string;
    rule_set_name: string;
    priority: string;
    rule_type: "hard_filter" | "soft_boost";
    target_level: "input" | "candidate" | "pair";
    condition_json: RuleCondition;
    effect_json: RuleEffect;
    stop_on_match: boolean;
    description: string | null;
  }>(
    `SELECT
       mr.id::text,
       mr.rule_set_id::text,
       mrs.name AS rule_set_name,
       mrs.priority::text,
       mr.rule_type,
       mr.target_level,
       mr.condition_json,
       mr.effect_json,
       mr.stop_on_match,
       mr.description
     FROM matching_rules mr
     JOIN matching_rule_sets mrs ON mrs.id = mr.rule_set_id
     WHERE mr.active = TRUE
       AND mrs.active = TRUE
       AND mr.rule_type = 'hard_filter'
     ORDER BY mrs.priority ASC, mr.id ASC`
  );

  return res.rows.map((row) => ({
    id: Number(row.id),
    rule_set_id: Number(row.rule_set_id),
    rule_set_name: row.rule_set_name,
    priority: Number(row.priority),
    rule_type: row.rule_type,
    target_level: row.target_level,
    condition_json: row.condition_json,
    effect_json: row.effect_json,
    stop_on_match: row.stop_on_match,
    description: row.description
  }));
}

async function loadAllRules(): Promise<Array<MatchingRuleRecord & { active: boolean }>> {
  const res = await matchPool.query<{
    id: string;
    rule_set_id: string;
    rule_set_name: string;
    priority: string;
    rule_type: "hard_filter" | "soft_boost";
    target_level: "input" | "candidate" | "pair";
    condition_json: RuleCondition;
    effect_json: RuleEffect;
    stop_on_match: boolean;
    description: string | null;
    active: boolean;
  }>(
    `SELECT
       mr.id::text,
       mr.rule_set_id::text,
       mrs.name AS rule_set_name,
       mrs.priority::text,
       mr.rule_type,
       mr.target_level,
       mr.condition_json,
       mr.effect_json,
       mr.stop_on_match,
       mr.description,
       mr.active
     FROM matching_rules mr
     JOIN matching_rule_sets mrs ON mrs.id = mr.rule_set_id
     ORDER BY mrs.priority ASC, mr.id ASC`
  );

  return res.rows.map((row) => ({
    id: Number(row.id),
    rule_set_id: Number(row.rule_set_id),
    rule_set_name: row.rule_set_name,
    priority: Number(row.priority),
    rule_type: row.rule_type,
    target_level: row.target_level,
    condition_json: row.condition_json,
    effect_json: row.effect_json,
    stop_on_match: row.stop_on_match,
    description: row.description,
    active: row.active
  }));
}

async function loadInstructionPolicies(): Promise<Array<{
  id: number;
  name: string;
  source_type: string;
  policy_json: InstructionPolicyPayload;
  use_count: number;
  success_count: number;
  failure_count: number;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}>> {
  const res = await matchPool.query<{
    id: string;
    name: string;
    source_type: string;
    policy_json: string;
    use_count: string;
    success_count: string;
    failure_count: string;
    active: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT
       id::text,
       name,
       source_type,
       policy_json::text,
       use_count::text,
       success_count::text,
       failure_count::text,
       active,
       created_at,
       updated_at
     FROM instruction_policies
     ORDER BY active DESC, success_count DESC, use_count DESC, id DESC`
  );

  return res.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    source_type: row.source_type,
    policy_json: JSON.parse(row.policy_json) as InstructionPolicyPayload,
    use_count: Number(row.use_count),
    success_count: Number(row.success_count),
    failure_count: Number(row.failure_count),
    active: row.active,
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
}

async function loadCandidateRowsByStockIds(stockIds: number[]): Promise<CandidateRow[]> {
  if (stockIds.length === 0) return [];
  const sqlProductTypeExpr = "COALESCE(NULLIF(sm.cinsi, ''), sf.product_type)";
  const sqlSeriesExpr = "NULLIF(sm.alasim, '')";
  const sqlSeriesGroupExpr = `COALESCE(
    CASE
      WHEN NULLIF(sm.alasim, '') ~ '^[1-9][0-9]{3}$'
      THEN SUBSTRING(NULLIF(sm.alasim, '') FROM 1 FOR 1) || '000'
      ELSE NULL
    END
  )`;
  const sqlTemperExpr = "COALESCE(NULLIF(sm.tamper, ''), sf.temper)";

  const res = await matchPool.query<CandidateRow>(
    `SELECT
       sm.stock_id,
       sm.stock_code,
       sm.stock_name,
       sm.birim,
       NULLIF(sm.erp_cap, 0)::float8 AS erp_cap,
       NULLIF(sm.erp_en, 0)::float8 AS erp_en,
       NULLIF(sm.erp_boy, 0)::float8 AS erp_boy,
       NULLIF(sm.erp_yukseklik, 0)::float8 AS erp_yukseklik,
       sm.alasim,
       sm.cinsi,
       sm.specific_gravity::float8 AS specific_gravity,
       ${sqlTemperExpr} AS tamper,
       ${sqlProductTypeExpr} AS product_type,
       ${sqlSeriesExpr} AS series,
       ${sqlSeriesGroupExpr} AS series_group,
       ${sqlTemperExpr} AS temper,
       sf.dim_text,
       sf.dim1::float8 AS dim1,
       sf.dim2::float8 AS dim2,
       sf.dim3::float8 AS dim3,
       0::float8 AS similarity
     FROM stock_master sm
     JOIN stock_features sf ON sf.stock_id = sm.stock_id
     WHERE sm.stock_id = ANY($1::int[])
     ORDER BY sm.stock_id ASC`,
    [stockIds]
  );
  return res.rows;
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

function normalizePositiveInteger(value: unknown): number | null {
  const parsed = toSafeNumber(value);
  if (!parsed || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function validateMatchedOfferErpInput(body: SendMatchedOfferToErpBody | undefined): { ok: true } | { ok: false; error: string } {
  const offerId = normalizePositiveInteger(body?.offerId);
  const movementCode = String(body?.movementCode ?? "").trim();
  const customerCode = String(body?.customerCode ?? "").trim();
  const representativeCode = String(body?.representativeCode ?? "").trim();
  const rows = Array.isArray(body?.rows) ? body.rows : [];

  if (!offerId) return { ok: false, error: "ERP'ye gondermeden once kayitli bir eslesme secilmeli" };
  if (!movementCode) return { ok: false, error: "Hareket Kodu secilmeli" };
  if (!customerCode) return { ok: false, error: "Cari secilmeli" };
  if (!representativeCode) return { ok: false, error: "Musteri Temsilcisi secilmeli" };
  if (rows.length === 0) return { ok: false, error: "Gonderilecek satir bulunamadi" };

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const selectedStockId = normalizePositiveInteger(row.selected_stock_id);
    const quantity = normalizePositiveInteger(row.quantity);
    if (!selectedStockId) {
      return { ok: false, error: `Satir ${index + 1}: secili stok bulunamadi` };
    }
    if (!quantity) {
      return { ok: false, error: `Satir ${index + 1}: adet pozitif olmali` };
    }
  }

  return { ok: true };
}

async function buildInsertOfferPayload(body: SendMatchedOfferToErpBody): Promise<InsertOfferPayload> {
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const transportTypeCode = String(body.transportTypeCode ?? body.incotermName ?? "").trim() || null;
  const paymentPlanCode = String(body.paymentPlanCode ?? "").trim() || null;
  const shippingDate = formatOfferDateForUyum(body.deliveryDate ?? null);
  const deliveryDate = formatOfferDateForUyum(body.deliveryDate ?? null);
  const stockIds = [...new Set(rows.map((row) => normalizePositiveInteger(row.selected_stock_id)).filter((value): value is number => Boolean(value)))];
  const stockRes = await matchPool.query<{ stock_id: number; stock_code: string | null }>(
    `SELECT stock_id, stock_code
     FROM stock_master
     WHERE stock_id = ANY($1::bigint[])`,
    [stockIds]
  );

  const stockCodeMap = new Map<number, string>(
    stockRes.rows
      .filter((row) => String(row.stock_code ?? "").trim())
      .map((row) => [Number(row.stock_id), String(row.stock_code ?? "").trim()])
  );

  const details = rows.map((row, index) => {
    const stockId = normalizePositiveInteger(row.selected_stock_id) as number;
    const quantity = normalizePositiveInteger(row.quantity) as number;
    const stockCode = stockCodeMap.get(stockId);
    const mensei = String(row.mensei ?? "").trim().toLocaleUpperCase("tr-TR") || "Ä°THAL";
    if (!stockCode) {
      throw new Error(`Satir ${index + 1}: ERP stok kodu bulunamadi`);
    }

    const amount = quantity;
    return {
      lineType: "S",
      DcardCode: stockCode,
      ItemAttributeCode1: mensei,
      unitId: 165,
      qty: quantity,
      unitPriceTra: 1,
      unitPrice: 1,
      vatId: 424,
      vatStatus: "Hariç",
      whouseId: 3681,
      amt: amount,
      amtTra: 0,
      lineNo: (index + 1) * 10,
      curTraId: 114
    };
  });

  return {
    Value: {
      sourceApp: "SatışTeklifi",
      details,
      EntityCode: String(body.customerCode ?? "").trim(),
      DocTraCode: String(body.movementCode ?? "").trim(),
      SalesPersonCode: String(body.representativeCode ?? "").trim(),
      TransportTypeCode: transportTypeCode ?? undefined,
      PaymentPlanCode: paymentPlanCode ?? undefined,
      ShippingDate: shippingDate ?? undefined,
      DeliveryDate: deliveryDate ?? undefined,
      amt: details.reduce((sum, item) => sum + item.amt, 0),
      curTra: 2220,
      curId: 114,
      coId: 2715,
      branchId: 6749
    }
  };
}

async function sendInsertOfferToUyum(payload: InsertOfferPayload): Promise<unknown> {
  try {
    return await postUyumRequest("/UyumApi/v1/PSM/InsertOffer", payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("HTTP 417")) {
      throw error;
    }

    const fallbackPayload: InsertOfferPayloadLowercase = {
      value: payload.Value
    };
    return await postUyumRequest("/UyumApi/v1/PSM/InsertOffer", fallbackPayload);
  }
}

async function upsertMatchedOffer(currentUserId: number, body: SaveMatchedOfferBody): Promise<number> {
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const client = await matchPool.connect();
  try {
    await client.query("BEGIN");

    const normalizedTitle = String(body.title ?? "").trim() || String(body.sourceName ?? "").trim() || `Teklif ${new Date().toISOString()}`;
    const lineCount = rows.length;
    const offerDate = String(body.offerDate ?? "").trim() || null;
    const movementCode = String(body.movementCode ?? "").trim() || null;
    const customerCode = String(body.customerCode ?? "").trim() || null;
    const representativeCode = String(body.representativeCode ?? "").trim() || null;
    const warehouseCode = String(body.warehouseCode ?? "").trim() || null;
    const paymentPlanCode = String(body.paymentPlanCode ?? "").trim() || null;
    const incotermName = String(body.transportTypeCode ?? body.incotermName ?? "").trim() || null;
    const deliveryDate = String(body.deliveryDate ?? "").trim() || null;
    const description = String(body.description ?? "").trim() || null;
    let offerId = Number(body.offerId);

    if (!Number.isFinite(offerId) || offerId <= 0) {
      const insertRes = await client.query<{ id: string }>(
        `INSERT INTO matched_offers(
           title, source_name, source_type, extraction_method, profile_name, created_by_user_id, line_count, status,
           offer_date, movement_code, customer_code, representative_code, warehouse_code, payment_plan_code, incoterm_name, delivery_date, description
         )
         VALUES($1,$2,$3,$4,$5,$6,$7,'saved',$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id::text`,
        [
          normalizedTitle,
          String(body.sourceName ?? "").trim() || null,
          String(body.sourceType ?? "").trim() || null,
          String(body.extractionMethod ?? "").trim() || null,
          String(body.profileName ?? "").trim() || null,
          currentUserId,
          lineCount,
          offerDate,
          movementCode,
          customerCode,
          representativeCode,
          warehouseCode,
          paymentPlanCode,
          incotermName,
          deliveryDate,
          description
        ]
      );
      offerId = Number(insertRes.rows[0].id);
    } else {
      const existingRes = await client.query<{ status: string | null }>(
        `SELECT status
         FROM matched_offers
         WHERE id=$1
         LIMIT 1`,
        [offerId]
      );
      if (existingRes.rowCount === 0) {
        throw new Error("Kayit bulunamadi");
      }
      if (String(existingRes.rows[0]?.status ?? "").trim().toLowerCase() === "sent") {
        throw new Error("Kayitli eslesme degistirilemez");
      }

      await client.query(
        `UPDATE matched_offers
         SET title=$2,
             source_name=$3,
             source_type=$4,
             extraction_method=$5,
             profile_name=$6,
             line_count=$7,
             offer_date=$8,
             movement_code=$9,
             customer_code=$10,
             representative_code=$11,
             warehouse_code=$12,
             payment_plan_code=$13,
             incoterm_name=$14,
             delivery_date=$15,
             description=$16,
             updated_at=NOW()
         WHERE id=$1`,
        [
          offerId,
          normalizedTitle,
          String(body.sourceName ?? "").trim() || null,
          String(body.sourceType ?? "").trim() || null,
          String(body.extractionMethod ?? "").trim() || null,
          String(body.profileName ?? "").trim() || null,
          lineCount,
          offerDate,
          movementCode,
          customerCode,
          representativeCode,
          warehouseCode,
          paymentPlanCode,
          incotermName,
          deliveryDate,
          description
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
           quantity, kg, talas_mik, musteri_no, musteri_parca_no,
           dim_kalinlik, dim_en, dim_boy, kesim_durumu, selected_score, is_manual, source_line_text, line_json
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)`,
        [
          offerId,
          index + 1,
          toSafeNumber(row.matchHistoryId),
          stockId,
          stockCode,
          stockName,
          birim,
          toSafeNumber(row.quantity),
          toSafeNumber(row.kg),
          toSafeNumber(row.talasMik),
          String(row.musteriNo ?? "").trim() || null,
          String(row.musteriParcaNo ?? "").trim() || null,
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
      sentToErp: row.status === "sent",
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
    offer_date: string | null;
    movement_code: string | null;
    customer_code: string | null;
    representative_code: string | null;
    warehouse_code: string | null;
    payment_plan_code: string | null;
    incoterm_name: string | null;
    delivery_date: string | null;
    description: string | null;
    status: string | null;
    created_by_user_id: string | null;
    created_at: Date;
  }>(
    `SELECT id::text, title, source_name, source_type, extraction_method, profile_name,
            TO_CHAR(offer_date, 'YYYY-MM-DD') AS offer_date,
            movement_code, customer_code, representative_code,
            warehouse_code, payment_plan_code, incoterm_name,
            TO_CHAR(delivery_date, 'YYYY-MM-DD') AS delivery_date,
            description,
            status, created_by_user_id::text, created_at
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
    kg: string | null;
    talas_mik: string | null;
    musteri_no: string | null;
    musteri_parca_no: string | null;
    dim_kalinlik: string | null;
    dim_en: string | null;
    dim_boy: string | null;
    alasim: string | null;
    tamper: string | null;
    kesim_durumu: string | null;
    selected_score: string | null;
    is_manual: boolean;
  }>(
    `SELECT line_no, match_history_id::text, selected_stock_id, stock_code, stock_name, birim,
            quantity::text, kg::text, talas_mik::text, musteri_no, musteri_parca_no,
            dim_kalinlik::text, dim_en::text, dim_boy::text,
            NULLIF(line_json->>'alasim', '') AS alasim,
            NULLIF(line_json->>'tamper', '') AS tamper,
            kesim_durumu, selected_score::text, is_manual
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
      offerDate: offer.offer_date,
      movementCode: offer.movement_code,
      customerCode: offer.customer_code,
      representativeCode: offer.representative_code,
      warehouseCode: offer.warehouse_code,
      paymentPlanCode: offer.payment_plan_code,
      incotermName: offer.incoterm_name,
      transportTypeCode: offer.incoterm_name,
      deliveryDate: offer.delivery_date,
      description: offer.description,
      status: offer.status,
      sentToErp: offer.status === "sent",
      createdAt: offer.created_at
    },
    rows: linesRes.rows.map((row) => ({
      matchHistoryId: row.match_history_id ? Number(row.match_history_id) : null,
      selected_stock_id: row.selected_stock_id && row.selected_stock_id > 0 ? row.selected_stock_id : null,
      selected_score: row.selected_stock_id && row.selected_stock_id > 0 ? toSafeNumber(row.selected_score) : null,
      quantity: toSafeNumber(row.quantity),
      kg: toSafeNumber(row.kg),
      talasMik: toSafeNumber(row.talas_mik),
      musteriNo: row.musteri_no,
      musteriParcaNo: row.musteri_parca_no,
      dimKalinlik: toSafeNumber(row.dim_kalinlik),
      dimEn: toSafeNumber(row.dim_en),
      dimBoy: toSafeNumber(row.dim_boy),
      alasim: row.alasim,
      tamper: row.tamper,
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

  try {
    const offerId = await upsertMatchedOffer(authUser.id, request.body);
    return { ok: true, offerId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Kayit bulunamadi") {
      return reply.code(404).send({ error: message });
    }
    if (message === "Kayitli eslesme degistirilemez") {
      return reply.code(409).send({ error: message });
    }
    throw error;
  }
});

app.post<{ Body: SendMatchedOfferToErpBody }>("/matched-offers/send-erp", async (request, reply) => {
  const authUser = await resolveRequestUser(request);
  if (!authUser) {
    return reply.code(401).send({ error: "Unauthorized" });
  }

  const validation = validateMatchedOfferErpInput(request.body);
  if (!validation.ok) {
    return reply.code(400).send({ error: validation.error });
  }

  try {
    const offerId = normalizePositiveInteger(request.body?.offerId);
    if (offerId) {
      const existingRes = await matchPool.query<{ status: string | null }>(
        `SELECT status
         FROM matched_offers
         WHERE id=$1
         LIMIT 1`,
        [offerId]
      );
      if (existingRes.rowCount === 0) {
        return reply.code(404).send({ error: "Kayit bulunamadi" });
      }
      if (String(existingRes.rows[0]?.status ?? "").trim().toLowerCase() === "sent") {
        return reply.code(409).send({ error: "Bu eslesme ERP'ye daha once gonderilmis" });
      }
    }

    const payload = await buildInsertOfferPayload(request.body);
    const uyumResponse = await sendInsertOfferToUyum(payload);
    if (offerId) {
      await matchPool.query(
        `UPDATE matched_offers
         SET status='sent', updated_at=NOW()
         WHERE id=$1`,
        [offerId]
      );
    }
    return {
      ok: true,
      offerId: offerId ?? null,
      payload,
      uyumResponse
    };
  } catch (error) {
    request.log.error({ err: error, offerId: request.body?.offerId ?? null }, "matched offer send to erp failed");
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(500).send({ error: message });
  }
});

app.post<{ Body: { rows?: ExportMatchedTableRowInput[] } }>("/exports/matched-table", async (request, reply) => {
  const rows = Array.isArray(request.body?.rows) ? request.body.rows : [];
  if (rows.length === 0) {
    return reply.code(400).send({ error: "AktarÄ±lacak satÄ±r bulunamadÄ±" });
  }

  const exportRows = rows.map((row, index) => ({
    "SÄ±ra": Number.isFinite(Number(row.sira)) ? Number(row.sira) : index + 1,
    "KalÄ±nlÄ±k": row.kalinlik ?? "",
    "En": row.en ?? "",
    "Boy": row.boy ?? "",
    "Stok Kodu": String(row.stokKodu ?? "").trim(),
    "Stok AdÄ±": String(row.stokAdi ?? "").trim(),
    "Birim": String(row.birim ?? "").trim(),
    "Kesim Durumu": String(row.kesimDurumu ?? "").trim(),
    "MenÅŸei": String(row.mensei ?? "").trim(),
    "Adet": row.adet ?? ""
  }));

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(exportRows);
  worksheet["!cols"] = [
    { wch: 8 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 24 },
    { wch: 42 },
    { wch: 10 },
    { wch: 16 },
    { wch: 12 },
    { wch: 10 }
  ];
  XLSX.utils.book_append_sheet(workbook, worksheet, "Eslestirilen Satirlar");

  const fileBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  reply.header("Content-Disposition", `attachment; filename="eslestirilen-satirlar-${stamp}.xlsx"`);
  return reply.send(fileBuffer);
});

app.get("/stocks", async () => {
  const res = await matchPool.query<{
    stock_id: number;
    stock_code: string | null;
    stock_name: string | null;
    birim: string | null;
    erp_en: number | null;
    erp_boy: number | null;
    erp_yukseklik: number | null;
    erp_cap: number | null;
    specific_gravity: number | null;
    cinsi: string | null;
    alasim: string | null;
    tamper: string | null;
  }>(
    `SELECT
       sm.stock_id,
       sm.stock_code,
       sm.stock_name,
       sm.birim,
       sm.erp_en,
       sm.erp_boy,
       sm.erp_yukseklik,
       sm.erp_cap,
       sm.specific_gravity,
       sm.cinsi,
       sm.alasim,
       sm.tamper
      FROM stock_master sm
      WHERE sm.is_active = TRUE
      ORDER BY COALESCE(sm.stock_code, ''), COALESCE(sm.stock_name, '')
      LIMIT 5000`
  );

  return {
    items: res.rows.map((row) => ({
      stock_id: Number(row.stock_id),
      stock_code: row.stock_code,
      stock_name: row.stock_name,
      birim: row.birim,
      erp_en: row.erp_en,
      erp_boy: row.erp_boy,
      erp_yukseklik: row.erp_yukseklik,
      erp_cap: row.erp_cap,
      specific_gravity: row.specific_gravity,
      cinsi: row.cinsi,
      alasim: row.alasim,
      tamper: row.tamper
    }))
  };
});

app.get("/matching-rules", async () => {
  const items = await loadAllRules();
  return { items };
});

app.get("/instruction-policies", async () => {
  const items = await loadInstructionPolicies();
  return { items };
});

app.post<{
  Body: {
    ruleSetName?: string;
    scopeType?: string;
    scopeValue?: string | null;
    priority?: number;
    ruleType?: "hard_filter" | "soft_boost";
    targetLevel?: "input" | "candidate" | "pair";
    conditionJson?: RuleCondition;
    effectJson?: RuleEffect;
    stopOnMatch?: boolean;
    active?: boolean;
    description?: string | null;
    createdBy?: string | null;
  };
}>("/matching-rules", async (request, reply) => {
  const ruleSetName = String(request.body?.ruleSetName ?? (request.body as { rule_set_name?: string } | undefined)?.rule_set_name ?? "").trim();
  const scopeType = String(request.body?.scopeType ?? (request.body as { scope_type?: string } | undefined)?.scope_type ?? "global").trim() || "global";
  const scopeValue = String(request.body?.scopeValue ?? (request.body as { scope_value?: string | null } | undefined)?.scope_value ?? "").trim() || null;
  const priority = Number(request.body?.priority ?? 100);
  const ruleType = request.body?.ruleType ?? (request.body as { rule_type?: "hard_filter" | "soft_boost" } | undefined)?.rule_type ?? "hard_filter";
  const targetLevel = request.body?.targetLevel ?? (request.body as { target_level?: "input" | "candidate" | "pair" } | undefined)?.target_level ?? "pair";
  const conditionJson = request.body?.conditionJson ?? (request.body as { condition_json?: RuleCondition } | undefined)?.condition_json;
  const effectJson = request.body?.effectJson ?? (request.body as { effect_json?: RuleEffect } | undefined)?.effect_json;
  const stopOnMatch = request.body?.stopOnMatch === true || (request.body as { stop_on_match?: boolean } | undefined)?.stop_on_match === true;
  const active = request.body?.active !== false && (request.body as { is_active?: boolean } | undefined)?.is_active !== false;
  const description = String(request.body?.description ?? "").trim() || null;
  const createdBy = String(request.body?.createdBy ?? "").trim() || null;

  if (!ruleSetName || !conditionJson || !effectJson) {
    return reply.code(400).send({ error: "ruleSetName, conditionJson ve effectJson gerekli" });
  }

  const client = await matchPool.connect();
  try {
    await client.query("BEGIN");
    const ruleSetInsert = await client.query<{ id: string }>(
      `INSERT INTO matching_rule_sets(name, scope_type, scope_value, priority, active, created_by)
       VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id::text`,
      [ruleSetName, scopeType, scopeValue, priority, active, createdBy]
    );
    const ruleSetId = Number(ruleSetInsert.rows[0].id);
    const ruleInsert = await client.query<{ id: string }>(
      `INSERT INTO matching_rules(
         rule_set_id, rule_type, target_level, condition_json, effect_json, stop_on_match, active, description
       ) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8)
       RETURNING id::text`,
      [ruleSetId, ruleType, targetLevel, JSON.stringify(conditionJson), JSON.stringify(effectJson), stopOnMatch, active, description]
    );
    await client.query("COMMIT");
    return { ok: true, ruleSetId, ruleId: Number(ruleInsert.rows[0].id) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

app.put<{
  Params: { id: string };
  Body: {
    active?: boolean;
    conditionJson?: RuleCondition;
    effectJson?: RuleEffect;
    stopOnMatch?: boolean;
    description?: string | null;
    priority?: number;
  };
}>("/matching-rules/:id", async (request, reply) => {
  const ruleId = Number(request.params.id);
  if (!Number.isFinite(ruleId) || ruleId <= 0) {
    return reply.code(400).send({ error: "gecersiz rule id" });
  }

  const existing = await matchPool.query<{ rule_set_id: string }>(
    "SELECT rule_set_id::text FROM matching_rules WHERE id = $1",
    [ruleId]
  );
  if (existing.rowCount === 0) {
    return reply.code(404).send({ error: "rule not found" });
  }

  const updates: string[] = [];
  const params: unknown[] = [ruleId];
  let idx = 2;

  const body = request.body as {
    active?: boolean;
    is_active?: boolean;
    conditionJson?: RuleCondition;
    condition_json?: RuleCondition;
    effectJson?: RuleEffect;
    effect_json?: RuleEffect;
    stopOnMatch?: boolean;
    stop_on_match?: boolean;
    description?: string | null;
    priority?: number;
  } | undefined;

  if (body?.conditionJson || body?.condition_json) {
    updates.push(`condition_json = $${idx}::jsonb`);
    params.push(JSON.stringify(body.conditionJson ?? body.condition_json));
    idx += 1;
  }
  if (body?.effectJson || body?.effect_json) {
    updates.push(`effect_json = $${idx}::jsonb`);
    params.push(JSON.stringify(body.effectJson ?? body.effect_json));
    idx += 1;
  }
  if (typeof body?.stopOnMatch === "boolean" || typeof body?.stop_on_match === "boolean") {
    updates.push(`stop_on_match = $${idx}`);
    params.push(body.stopOnMatch ?? body.stop_on_match);
    idx += 1;
  }
  if (typeof body?.active === "boolean" || typeof body?.is_active === "boolean") {
    updates.push(`active = $${idx}`);
    params.push(body.active ?? body.is_active);
    idx += 1;
  }
  if (body?.description !== undefined) {
    updates.push(`description = $${idx}`);
    params.push(String(body.description ?? "").trim() || null);
    idx += 1;
  }

  if (updates.length > 0) {
    updates.push("updated_at = NOW()");
    await matchPool.query(
      `UPDATE matching_rules SET ${updates.join(", ")} WHERE id = $1`,
      params
    );
  }

  if (body?.priority !== undefined) {
    await matchPool.query(
      `UPDATE matching_rule_sets
       SET priority = $2, updated_at = NOW()
       WHERE id = $1`,
      [Number(existing.rows[0].rule_set_id), Number(body.priority)]
    );
  }

  return { ok: true };
});

app.put<{
  Params: { id: string };
  Body: {
    active?: boolean;
    name?: string;
  };
}>("/instruction-policies/:id", async (request, reply) => {
  const policyId = Number(request.params.id);
  if (!Number.isFinite(policyId) || policyId <= 0) {
    return reply.code(400).send({ error: "gecersiz policy id" });
  }

  const updates: string[] = [];
  const params: unknown[] = [policyId];
  let idx = 2;

  if (typeof request.body?.active === "boolean") {
    updates.push(`active = $${idx}`);
    params.push(request.body.active);
    idx += 1;
  }
  if (request.body?.name !== undefined) {
    updates.push(`name = $${idx}`);
    params.push(String(request.body.name ?? "").trim() || "manual-policy");
    idx += 1;
  }

  if (updates.length === 0) {
    return { ok: true };
  }

  updates.push("updated_at = NOW()");
  const result = await matchPool.query(
    `UPDATE instruction_policies
     SET ${updates.join(", ")}
     WHERE id = $1`,
    params
  );

  if ((result.rowCount ?? 0) === 0) {
    return reply.code(404).send({ error: "policy not found" });
  }

  return { ok: true };
});

app.post<{
  Body: {
    text?: string;
    ruleIds?: number[];
    candidateStockIds?: number[];
  };
}>("/matching-rules/test", async (request, reply) => {
  const text = String(request.body?.text ?? (request.body as { inputText?: string } | undefined)?.inputText ?? "").trim();
  const ruleIds = Array.isArray(request.body?.ruleIds)
    ? request.body.ruleIds.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)
    : [];
  const candidateStockIds = Array.isArray(request.body?.candidateStockIds)
    ? request.body.candidateStockIds.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)
    : [];

  if (!text || candidateStockIds.length === 0) {
    return reply.code(400).send({ error: "text ve candidateStockIds gerekli" });
  }

  const extracted = extractFeaturesFromInput(text);
  const candidates = await loadCandidateRowsByStockIds(candidateStockIds);
  if (candidates.length === 0) {
    return { ok: true, extracted, beforeCount: 0, afterCount: 0, audits: [], items: [] };
  }

  const activeRules = await loadActiveHardRules();
  const rules = ruleIds.length > 0 ? activeRules.filter((rule) => ruleIds.includes(rule.id)) : activeRules;
  const evaluation = evaluateHardRules(extracted, candidates, rules);

  return {
    ok: true,
    extracted,
    beforeCount: candidates.length,
    afterCount: evaluation.candidates.length,
    audits: evaluation.audits,
    items: evaluation.candidates.map((candidate) => ({
      stock_id: candidate.stock_id,
      stock_code: candidate.stock_code,
      stock_name: candidate.stock_name,
      rule_hits: evaluation.candidateRuleHits.get(Number(candidate.stock_id)) ?? []
    }))
  };
});

app.get<{ Querystring: { limit?: string } }>("/matching-rules/audit-recent", async (request) => {
  const limit = Math.max(1, Math.min(50, Number(request.query?.limit ?? 12)));
  const res = await matchPool.query<{
    id: string;
    created_at: Date;
    input_text: string;
    selected_stock_id: number | null;
    stock_code: string | null;
    stock_name: string | null;
    rule_summary_json: string | null;
  }>(
    `SELECT
       mh.id::text,
       mh.created_at,
       mh.input_text,
       mh.selected_stock_id,
       sm.stock_code,
       sm.stock_name,
       mh.rule_summary_json::text
     FROM match_history mh
     LEFT JOIN stock_master sm ON sm.stock_id = mh.selected_stock_id
     WHERE mh.rule_summary_json IS NOT NULL
     ORDER BY mh.id DESC
     LIMIT $1`,
    [limit]
  );

  return {
    items: res.rows.map((row) => ({
      id: Number(row.id),
      created_at: row.created_at,
      input_text: row.input_text,
      selected_stock_id: row.selected_stock_id !== null ? Number(row.selected_stock_id) : null,
      stock_code: row.stock_code ?? null,
      stock_name: row.stock_name ?? null,
      rule_summary_json: row.rule_summary_json ? JSON.parse(row.rule_summary_json) : null
    }))
  };
});

app.get<{ Params: { matchHistoryId: string } }>("/matching-rules/audit/:matchHistoryId", async (request, reply) => {
  const matchHistoryId = Number(request.params.matchHistoryId);
  if (!Number.isFinite(matchHistoryId) || matchHistoryId <= 0) {
    return reply.code(400).send({ error: "gecersiz matchHistoryId" });
  }

  const res = await matchPool.query<{
    id: string;
    rule_id: string;
    candidate_stock_id: number | null;
    decision: string;
    delta_score: string | null;
    reason_text: string | null;
    created_at: Date;
  }>(
    `SELECT id::text, rule_id::text, candidate_stock_id, decision, delta_score::text, reason_text, created_at
     FROM matching_rule_audit
     WHERE match_history_id = $1
     ORDER BY id ASC`,
    [matchHistoryId]
  );

  return {
    items: res.rows.map((row) => ({
      id: Number(row.id),
      rule_id: Number(row.rule_id),
      candidate_stock_id: row.candidate_stock_id !== null ? Number(row.candidate_stock_id) : null,
      decision: row.decision,
      delta_score: row.delta_score !== null ? Number(row.delta_score) : null,
      reason_text: row.reason_text ?? "",
      created_at: row.created_at
    }))
  };
});

app.get<{ Params: { lookupKey: string }; Querystring: { q?: string; limit?: string } }>("/lookups/:lookupKey", async (request, reply) => {
  try {
    const items = await getLookupOptions(String(request.params.lookupKey ?? "").trim(), {
      query: String(request.query?.q ?? "").trim(),
      limit: Number(request.query?.limit ?? 30)
    });
    return { items };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = message.startsWith("Unknown lookup key:") ? 404 : 500;
    request.log.error({ err: error, lookupKey: request.params.lookupKey }, "lookup fetch failed");
    return reply.code(statusCode).send({ error: message });
  }
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
    message: string;
    rowCount?: number;
    sourceMode?: string;
  };
}>("/instructions/plan", async (request, reply) => {
  const message = request.body?.message?.trim() ?? "";
  if (!message) {
    return reply.code(400).send({ error: "message gerekli" });
  }

  return {
    ok: true,
    plan: planInstructionMessage({
      message,
      rowCount: Math.max(0, Number(request.body?.rowCount ?? 0)),
      sourceMode: request.body?.sourceMode?.trim() || "text"
    })
  };
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
      hash: extractedDoc.learning.fingerprint_hash ?? ""
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
      hash: extractedDoc.learning.fingerprint_hash ?? ""
    },
    userInstruction: extractedDoc.learning.user_instruction ?? null,
    effectiveInstruction: extractedDoc.learning.effective_instruction ?? null,
    extractedDoc,
    approved: request.body?.approved !== false
  });

  return { ok: true };
});

app.post<{
  Body: {
    rawMessage: string;
    plan: ReturnType<typeof planInstructionMessage>;
    extractedDoc: ParsedOrderDocument;
    approved?: boolean;
    sourceName?: string;
  };
}>("/instruction-policies/commit", async (request, reply) => {
  const extractedDoc = request.body?.extractedDoc;
  const plan = request.body?.plan;
  const rawMessage = request.body?.rawMessage?.trim() ?? "";
  if (!rawMessage || !plan || !extractedDoc?.learning?.fingerprint_text || !extractedDoc.learning.fingerprint_json) {
    return reply.code(400).send({ error: "rawMessage, plan ve extractedDoc learning metadata gerekli" });
  }

  const result = await commitInstructionPolicy({
    fingerprint: {
      sourceType: extractedDoc.source_type,
      text: extractedDoc.learning.fingerprint_text,
      json: extractedDoc.learning.fingerprint_json,
      hash: extractedDoc.learning.fingerprint_hash ?? ""
    },
    sourceName: request.body?.sourceName?.trim() || null,
    rawMessage,
    plan,
    approved: request.body?.approved !== false
  });

  return { ok: true, ...result };
});

app.post<{ Body: MatchInput }>("/match", async (request, reply) => {
  const text = request.body?.text?.trim() ?? "";
  const topK = Math.max(1, Math.min(20, request.body?.topK ?? 5));

  if (!text) {
    return reply.code(400).send({ error: "text is required" });
  }

  const extracted = extractFeaturesFromInput(text);
  const hasInputDims = [extracted.dim1, extracted.dim2, extracted.dim3].some((n) => typeof n === "number");
  const inputThickness = [extracted.dim1, extracted.dim2, extracted.dim3]
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    .sort((a, b) => a - b)[0] ?? null;
  const candidateLimit = hasInputDims ? 350 : 120;
  const guidance = buildGuidance(request.body?.matchInstruction, request.body?.matchPolicy);
  const sqlProductTypeExpr = "COALESCE(NULLIF(sm.cinsi, ''), sf.product_type)";
  const sqlSeriesExpr = "NULLIF(sm.alasim, '')";
  const sqlSeriesGroupExpr = `COALESCE(
    CASE
      WHEN NULLIF(sm.alasim, '') ~ '^[1-9][0-9]{3}$'
      THEN SUBSTRING(NULLIF(sm.alasim, '') FROM 1 FOR 1) || '000'
      ELSE NULL
    END
  )`;
  const sqlTemperExpr = "COALESCE(NULLIF(sm.tamper, ''), sf.temper)";
  const sqlErpCapExpr = "NULLIF(sm.erp_cap, 0)::float8";

  const conditions: string[] = ["sm.is_active = TRUE"];
  const params: unknown[] = [extracted.normalized_text];
  let idx = 2;

  const seriesFilter = request.body.filters?.series ?? extracted.series;
  const productTypeFilter = request.body.filters?.product_type ?? extracted.product_type;

  if (seriesFilter) {
    conditions.push(`(${sqlSeriesExpr} = $${idx} OR ${sqlSeriesGroupExpr} = $${idx + 1})`);
    params.push(seriesFilter, `${seriesFilter[0]}000`);
    idx += 2;
  } else if (extracted.series_group) {
    conditions.push(`${sqlSeriesGroupExpr} = $${idx}`);
    params.push(extracted.series_group);
    idx += 1;
  }

  if (productTypeFilter) {
    conditions.push(`${sqlProductTypeExpr} = $${idx}`);
    params.push(productTypeFilter.toUpperCase());
    idx += 1;
  }

  const exactCapCondition = inputThickness !== null
    ? `${sqlErpCapExpr} IS NOT NULL AND ABS(${sqlErpCapExpr} - $CAP$) <= 0.2`
    : null;
  const strictExactCapWhereSql = exactCapCondition
    ? `WHERE ${[...conditions, exactCapCondition.replace("$CAP$", `$${idx}`)].join(" AND ")}`
    : "";
  const strictExactCapParams = inputThickness !== null ? [...params, inputThickness] : params;
  const allActiveExactCapWhereSql = exactCapCondition
    ? `WHERE sm.is_active = TRUE AND ${exactCapCondition.replace("$CAP$", "$2")}`
    : "";
  const allActiveExactCapParams = inputThickness !== null ? [extracted.normalized_text, inputThickness] : [extracted.normalized_text];

  const buildSql = (whereSql: string, limit: number) => `
    SELECT
      sm.stock_id,
      sm.stock_code,
      sm.stock_name,
      sm.birim,
      NULLIF(sm.erp_cap, 0)::float8 AS erp_cap,
      NULLIF(sm.erp_en, 0)::float8 AS erp_en,
      NULLIF(sm.erp_boy, 0)::float8 AS erp_boy,
      NULLIF(sm.erp_yukseklik, 0)::float8 AS erp_yukseklik,
      sm.alasim,
      sm.cinsi,
      sm.specific_gravity::float8 AS specific_gravity,
      ${sqlTemperExpr} AS tamper,
      ${sqlProductTypeExpr} AS product_type,
      ${sqlSeriesExpr} AS series,
      ${sqlSeriesGroupExpr} AS series_group,
      ${sqlTemperExpr} AS temper,
      sf.dim_text,
      sf.dim1::float8 AS dim1,
      sf.dim2::float8 AS dim2,
      sf.dim3::float8 AS dim3,
      similarity(sf.search_text, $1) AS similarity
    FROM stock_master sm
    JOIN stock_features sf ON sf.stock_id = sm.stock_id
    ${whereSql}
    ORDER BY similarity DESC
    LIMIT ${limit}
  `;
  const searchStages = [
    ...(inputThickness !== null ? [{
      name: "strict_exact_cap",
      whereSql: strictExactCapWhereSql,
      queryParams: strictExactCapParams,
      limit: candidateLimit
    }] : []),
    ...(inputThickness !== null ? [{
      name: "all_active_exact_cap",
      whereSql: allActiveExactCapWhereSql,
      queryParams: allActiveExactCapParams,
      limit: Math.max(candidateLimit, 250)
    }] : []),
    {
      name: "strict",
      whereSql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
      queryParams: params,
      limit: candidateLimit
    },
    {
      name: "all_active",
      whereSql: "WHERE sm.is_active = TRUE",
      queryParams: [extracted.normalized_text],
      limit: candidateLimit
    },
    {
      name: "all_active_wide",
      whereSql: "WHERE sm.is_active = TRUE",
      queryParams: [extracted.normalized_text],
      limit: Math.max(candidateLimit * 3, 800)
    }
  ];

  let results: ScoredResult[] = [];
  let usedStage = "strict";
  let ruleSummary: {
    loadedRuleCount: number;
    appliedStage: string | null;
    rejectedCandidateCount: number;
  } = {
    loadedRuleCount: 0,
    appliedStage: null,
    rejectedCandidateCount: 0
  };
  const pendingRuleAudits: Array<{ ruleId: number; candidateStockId: number | null; decision: string; deltaScore: number | null; reasonText: string }> = [];
  const learningBoostMap = await buildLearningBoostMap({
    series: extracted.series,
    dim_text: extracted.dim_text
  });
  const hardRules = await loadActiveHardRules();
  ruleSummary.loadedRuleCount = hardRules.length;

  for (const stage of searchStages) {
    if (stage.name !== "strict" && stage.whereSql === searchStages[0].whereSql && stage.limit === searchStages[0].limit) {
      continue;
    }

    const candidateRes = await matchPool.query<CandidateRow>(buildSql(stage.whereSql, stage.limit), stage.queryParams);
    if (candidateRes.rows.length === 0) {
      continue;
    }

    let guidedCandidates = applyGuidanceFilters(candidateRes.rows, guidance);
    if (guidedCandidates.length === 0) {
      guidedCandidates = candidateRes.rows;
    }

    if (guidedCandidates.length === 0) {
      continue;
    }

    const hardRuleEval = evaluateHardRules(extracted, guidedCandidates, hardRules);
    if (hardRuleEval.candidates.length === 0) {
      ruleSummary.rejectedCandidateCount += guidedCandidates.length;
      pendingRuleAudits.push(...hardRuleEval.audits.map((audit) => ({
        ruleId: audit.ruleId,
        candidateStockId: audit.candidateStockId,
        decision: audit.decision,
        deltaScore: audit.deltaScore,
        reasonText: audit.reasonText
      })));
      continue;
    }

    const rawScored = baseScoreCandidates(extracted, hardRuleEval.candidates, hardRuleEval.candidates.length || topK).map((item) => ({
      ...item,
      rule_hits: hardRuleEval.candidateRuleHits.get(Number(item.stock_id)) ?? item.rule_hits ?? [],
      hard_rule_pass: true
    }));
    const guidedScored = applyGuidanceBoost(rawScored, hardRuleEval.candidates, guidance);
    const boosted = applyLearningBoost(guidedScored, learningBoostMap, guidedScored.length || topK);
    results = await rerankResults(text, boosted, topK);
    usedStage = stage.name;
    ruleSummary.appliedStage = stage.name;
    ruleSummary.rejectedCandidateCount += guidedCandidates.length - hardRuleEval.candidates.length;
    pendingRuleAudits.push(...hardRuleEval.audits.map((audit) => ({
      ruleId: audit.ruleId,
      candidateStockId: audit.candidateStockId,
      decision: audit.decision,
      deltaScore: audit.deltaScore,
      reasonText: audit.reasonText
    })));

    if (results.length > 0) {
      break;
    }
  }

  const historyRes = await matchPool.query<{ id: string }>(
    `INSERT INTO match_history(input_text, extracted_json, results_json, pipeline_version, rule_summary_json)
     VALUES($1, $2::jsonb, $3::jsonb, $4, $5::jsonb)
     RETURNING id`,
    [text, JSON.stringify(extracted), JSON.stringify(results), "v2-start", JSON.stringify(ruleSummary)]
  );
  const matchHistoryId = Number(historyRes.rows[0].id);

  if (pendingRuleAudits.length > 0) {
    for (const audit of pendingRuleAudits) {
      await matchPool.query(
        `INSERT INTO matching_rule_audit(match_history_id, rule_id, candidate_stock_id, decision, delta_score, reason_text)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [matchHistoryId, audit.ruleId, audit.candidateStockId, audit.decision, audit.deltaScore, audit.reasonText]
      );
    }
  }

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    await matchPool.query(
      `INSERT INTO match_candidate_features(match_history_id, stock_id, rank_before_ml, was_selected, feature_json, base_score, final_score)
       VALUES($1,$2,$3,FALSE,$4::jsonb,$5,$6)`,
      [
        matchHistoryId,
        Number(result.stock_id),
        index + 1,
        JSON.stringify({
          why: result.why,
          rule_hits: result.rule_hits ?? [],
          score_breakdown: result.score_breakdown ?? null
        }),
        result.score_breakdown ? result.score - result.score_breakdown.components.learning - result.score_breakdown.components.ml : result.score,
        result.score
      ]
    );
  }

  return {
    matchHistoryId,
    extracted,
    searchStage: usedStage,
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
  const shippingDate = formatErpDateTime(safeHeader.shippingDate ?? null);
  const deliveryDate = formatErpDateTime(safeHeader.deliveryDate ?? null);
  const paymentPlanDesc = String(safeHeader.paymentPlanDesc ?? "").trim() || null;
  const whouseCode = String(safeHeader.warehouseCode ?? "").trim() || null;

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
  const shippingDate = formatErpDateTime(safeHeader.shippingDate ?? null);
  const deliveryDate = formatErpDateTime(safeHeader.deliveryDate ?? null);
  const paymentPlanDesc = String(safeHeader.paymentPlanDesc ?? "").trim() || null;
  const whouseCode = String(safeHeader.warehouseCode ?? "").trim() || null;

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
        nakliyeSekli: String(safeHeader.nakliyeSekli).trim(),
        PaymentPlanDesc: paymentPlanDesc,
        ShippingDate: shippingDate,
        DeliveryDate: deliveryDate
      },
      line: {
        siraNo: index + 1,
        tip: (line.tip ?? "").toString().trim() || null,
        isyeriDepoKodu: (line.isyeriDepoKodu ?? "").toString().trim() || null,
        WhouseCode: whouseCode,
        ShippingDate: shippingDate,
        DeliveryDate: deliveryDate,
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



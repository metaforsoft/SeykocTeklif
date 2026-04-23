import { matchPool } from "@smp/db";
import { ScoredResult } from "@smp/common";

export interface TrainedModel {
  weights: number[];
  featureNames: string[];
  sampleCount: number;
  trainedAt: string;
}

const FEATURE_NAMES = [
  "bias",
  "base_score",
  "series_exact",
  "series_group_match",
  "temper_exact",
  "product_type_exact",
  "dimensions_exact",
  "nearest_upper_dimension",
  "upper_dimension_close",
  "thickness_exact",
  "nearest_upper_thickness",
  "upper_thickness_close",
  "below_requested_penalty",
  "trigram_component"
];

let modelCache: TrainedModel | null = null;

function sigmoid(z: number): number {
  if (z < -35) return 0;
  if (z > 35) return 1;
  return 1 / (1 + Math.exp(-z));
}

function parseTrigramWhy(why: string[]): number {
  const item = why.find((w) => w.startsWith("trigram "));
  if (!item) return 0;
  const n = Number(item.replace("trigram ", "").trim());
  return Number.isFinite(n) ? n : 0;
}

function toFeatureVectorLegacy(r: ScoredResult): number[] {
  const why = new Set(r.why);
  return [
    1,
    r.score,
    why.has("series exact") ? 1 : 0,
    why.has("series group match") ? 1 : 0,
    why.has("temper exact") ? 1 : 0,
    why.has("product type exact") ? 1 : 0,
    why.has("dimensions exact") ? 1 : 0,
    why.has("nearest upper dimension") ? 1 : 0,
    why.has("upper dimension close") ? 1 : 0,
    why.has("thickness exact") ? 1 : 0,
    why.has("nearest upper thickness") ? 1 : 0,
    why.has("upper thickness close") ? 1 : 0,
    why.has("thickness below requested") || why.has("dimension below requested") ? 1 : 0,
    parseTrigramWhy(r.why)
  ];
}

function toFeatureVector(r: ScoredResult): number[] {
  const bd = r.score_breakdown?.components;
  if (!bd) {
    // Fallback: eski yöntem (geriye uyumluluk)
    return toFeatureVectorLegacy(r);
  }
  return [
    1,                                    // bias
    r.score,                              // toplam skor
    bd.series > 30 ? 1 : 0,              // series exact (40 puan)
    bd.series > 0 && bd.series <= 30 ? 1 : 0, // series group (20 puan)
    bd.temper > 0 ? 1 : 0,               // temper match
    bd.product_type > 0 ? 1 : 0,         // product type match
    bd.dimensions > 20 ? 1 : 0,          // dimensions exact
    Math.max(0, bd.dimensions) / 25,     // nearest upper dimension analog
    bd.dimensions > 0 && bd.dimensions <= 15 ? 1 : 0, // upper dimension close
    bd.thickness > 15 ? 1 : 0,           // thickness exact
    Math.max(0, bd.thickness) / 20,      // thickness analog
    bd.thickness > 0 && bd.thickness <= 10 ? 1 : 0,  // upper thickness close
    bd.learning / 10,                    // learning boost (normalized)
    parseTrigramWhy(r.why)               // keep original parsing for trigrams as it's not explicit in breakdown yet
  ];
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

function trainLogReg(xs: number[][], ys: number[], iterations = 500, lr = 0.02, l2 = 0.0005): number[] {
  const dim = xs[0]?.length ?? 0;
  const w = new Array<number>(dim).fill(0);
  if (dim === 0) return w;

  for (let it = 0; it < iterations; it += 1) {
    const grad = new Array<number>(dim).fill(0);
    for (let i = 0; i < xs.length; i += 1) {
      const p = sigmoid(dot(w, xs[i]));
      const err = p - ys[i];
      for (let j = 0; j < dim; j += 1) grad[j] += err * xs[i][j];
    }
    for (let j = 0; j < dim; j += 1) {
      const reg = j === 0 ? 0 : l2 * w[j];
      w[j] -= lr * ((grad[j] / xs.length) + reg);
    }
  }

  return w;
}

export function applyMlRerank(results: ScoredResult[], topK: number): ScoredResult[] {
  if (!modelCache || modelCache.sampleCount < 8) return results.slice(0, topK);
  const w = modelCache.weights;

  const reranked = results.map((r) => {
    const x = toFeatureVector(r);
    const p = sigmoid(dot(w, x));
    const boost = (p - 0.5) * 30;
    return {
      ...r,
      score: Number((r.score + boost).toFixed(3)),
      why: [...r.why, `ml_olasilik ${(p * 100).toFixed(1)}%`],
      score_breakdown: r.score_breakdown
        ? {
          ...r.score_breakdown,
          components: {
            ...r.score_breakdown.components,
            ml: r.score_breakdown.components.ml + boost
          }
        }
        : r.score_breakdown
    };
  });

  return reranked.sort((a, b) => b.score - a.score).slice(0, topK);
}

export async function retrainModelFromHistory(limit = 3000): Promise<TrainedModel | null> {
  const res = await matchPool.query<{ results_json: unknown; selected_stock_id: number }>(
    `SELECT results_json, selected_stock_id
     FROM match_history
     WHERE selected_stock_id IS NOT NULL
       AND jsonb_typeof(results_json) = 'array'
     ORDER BY id DESC
     LIMIT $1`,
    [limit]
  );

  const xs: number[][] = [];
  const ys: number[] = [];

  for (const row of res.rows) {
    const selected = Number(row.selected_stock_id);
    const arr = Array.isArray(row.results_json) ? row.results_json as unknown[] : [];
    for (const item of arr) {
      const r = item as Partial<ScoredResult>;
      if (!r || typeof r.stock_id !== "number" || typeof r.score !== "number" || !Array.isArray(r.why)) continue;
      xs.push(toFeatureVector({
        stock_id: r.stock_id,
        stock_code: r.stock_code ?? null,
        stock_name: r.stock_name ?? null,
        birim: r.birim ?? null,
        score: r.score,
        why: r.why as string[]
      }));
      ys.push(r.stock_id === selected ? 1 : 0);
    }
  }

  if (xs.length < 8) {
    modelCache = null;
    return null;
  }

  const weights = trainLogReg(xs, ys);
  modelCache = {
    weights,
    featureNames: FEATURE_NAMES,
    sampleCount: xs.length,
    trainedAt: new Date().toISOString()
  };
  return modelCache;
}

export function getModelStatus(): TrainedModel | null {
  return modelCache;
}

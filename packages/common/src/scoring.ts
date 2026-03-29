import { CandidateRow, ExtractedFromInput, ScoredResult } from "./types";

function toInputDims(extracted: ExtractedFromInput): number[] {
  return [extracted.dim1, extracted.dim2, extracted.dim3].filter((n): n is number => typeof n === "number");
}

function toCandidateDims(c: CandidateRow): number[] {
  return [c.dim1, c.dim2, c.dim3].filter((n): n is number => typeof n === "number");
}

function parseMmFromName(name: string | null | undefined): number | null {
  if (!name) return null;
  const m = name.match(/(\d+(?:[\.,]\d+)?)\s*mm\b/i);
  if (!m?.[1]) return null;
  const n = Number(String(m[1]).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function dimDistance(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return Number.POSITIVE_INFINITY;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.reduce((sum, v, i) => sum + Math.abs(v - sb[i]), 0);
}

function directionalDimScore(input: number[], candidate: number[]): { delta: number; reasons: string[] } {
  const reasons: string[] = [];
  if (input.length === 0 || candidate.length === 0 || input.length !== candidate.length) {
    return { delta: 0, reasons };
  }

  const a = [...input].sort((x, y) => x - y);
  const b = [...candidate].sort((x, y) => x - y);
  let delta = 0;

  // Kural: olculer mumkunse asagi degil, yukari en yakin degerden secilsin.
  for (let i = 0; i < a.length; i += 1) {
    const gap = b[i] - a[i];
    if (gap < 0) {
      const isFirstDim = i === 0;
      delta -= isFirstDim ? 40 : 18;
      reasons.push(isFirstDim ? "thickness below requested" : "dimension below requested");
      continue;
    }

    if (gap === 0) {
      delta += i === 0 ? 12 : 8;
      continue;
    }

    if (gap <= 2) {
      delta += i === 0 ? 24 : 14;
      reasons.push("nearest upper dimension");
    } else if (gap <= 5) {
      delta += i === 0 ? 16 : 10;
      reasons.push("upper dimension close");
    } else if (gap <= 15) {
      delta += i === 0 ? 8 : 4;
    }
  }

  return { delta, reasons };
}

export function scoreCandidates(extracted: ExtractedFromInput, candidates: CandidateRow[], topK: number): ScoredResult[] {
  const inputDims = toInputDims(extracted);
  const inputThickness = inputDims.length > 0 ? [...inputDims].sort((a, b) => a - b)[0] : null;

  const scored = candidates.map((c) => {
    let score = 0;
    const why: string[] = [];

    if (extracted.series && c.series === extracted.series) {
      score += 40;
      why.push("series exact");
    } else if (extracted.series_group && c.series_group === extracted.series_group) {
      score += 20;
      why.push("series group match");
    }

    if (extracted.temper && c.temper && extracted.temper === c.temper) {
      score += 25;
      why.push("temper exact");
    }

    if (extracted.product_type && c.product_type && extracted.product_type === c.product_type) {
      score += 15;
      why.push("product type exact");
    }

    if (extracted.dim_text && c.dim_text && extracted.dim_text === c.dim_text) {
      score += 25;
      why.push("dimensions exact");
    }

    const candDims = toCandidateDims(c);
    const distance = dimDistance(inputDims, candDims);
    if (Number.isFinite(distance)) {
      if (distance <= 3) {
        score += 22;
        why.push("dimensions tolerance <=3");
      } else if (distance <= 8) {
        score += 14;
        why.push("dimensions tolerance <=8");
      } else if (distance <= 20) {
        score += 6;
        why.push("dimensions near");
      }
    }

    const directional = directionalDimScore(inputDims, candDims);
    if (directional.delta !== 0) {
      score += directional.delta;
      why.push(...directional.reasons);
    }

    // ERP boyut kolonlari bos gelirse, stok adindaki "MM" degerini kalinlik olarak kullan.
    if (inputThickness !== null && candDims.length === 0) {
      const mm = parseMmFromName(c.stock_name);
      if (mm !== null) {
        const gap = mm - inputThickness;
        if (gap < 0) {
          score -= 45;
          why.push("thickness below requested");
        } else if (gap === 0) {
          score += 28;
          why.push("thickness exact");
        } else if (gap <= 2) {
          score += 30;
          why.push("nearest upper thickness");
        } else if (gap <= 5) {
          score += 18;
          why.push("upper thickness close");
        } else if (gap <= 15) {
          score += 8;
          why.push("upper thickness");
        }
      }
    }

    const trigram = Math.max(0, Math.min(1, c.similarity));
    if (trigram > 0) {
      score += trigram * 10;
      why.push(`trigram ${(trigram * 10).toFixed(2)}`);
    }

    return {
      stock_id: c.stock_id,
      stock_code: c.stock_code,
      stock_name: c.stock_name,
      score: Number(score.toFixed(3)),
      why
    };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

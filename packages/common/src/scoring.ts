import { CandidateRow, ExtractedFromInput, ScoreBreakdown, ScoredResult } from "./types";

function toInputDims(extracted: ExtractedFromInput): number[] {
  return [extracted.dim1, extracted.dim2, extracted.dim3].filter((n): n is number => typeof n === "number");
}

function toCandidateDims(c: CandidateRow): number[] {
  return [c.dim1, c.dim2, c.dim3].filter((n): n is number => typeof n === "number");
}

function createBreakdown(): ScoreBreakdown {
  return {
    base_score: 0,
    components: {
      series: 0,
      temper: 0,
      product_type: 0,
      dimensions: 0,
      secondary_dimensions: 0,
      thickness: 0,
      text_similarity: 0,
      stock_family: 0,
      instruction: 0,
      learning: 0,
      ml: 0
    }
  };
}

function parseMmFromName(name: string | null | undefined): number | null {
  if (!name) return null;
  const m = name.match(/(\d+(?:[\.,]\d+)?)\s*mm\b/i);
  if (!m?.[1]) return null;
  const n = Number(String(m[1]).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseThicknessFromCode(code: string | null | undefined): number | null {
  if (!code) return null;
  const normalized = String(code).trim().replace(",", ".");
  const dottedBlocks = [...normalized.matchAll(/\.([0-9]{4})(?=\.|$)/g)].map((match) => match[1]).filter(Boolean);
  for (const raw of dottedBlocks.reverse()) {
    if (raw === "0000") continue;
    if (raw.startsWith("00")) {
      const numeric = Number(raw.slice(2));
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
      }
      continue;
    }

    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }

  const mmMatches = [...normalized.matchAll(/(?:^|[^\d])(\d{1,4})(?=mm\b)/gi)];
  for (const match of mmMatches.reverse()) {
    const raw = match[1];
    if (!raw) continue;
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }

  return null;
}

function normalizedNumeric(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function getStockPrefix(code: string | null | undefined): string | null {
  if (!code) return null;
  const prefix = String(code).trim().split(".")[0]?.toUpperCase() ?? "";
  return prefix || null;
}

function hasExactErpCapCandidate(candidates: CandidateRow[], inputThickness: number | null): boolean {
  if (inputThickness === null) return false;
  return candidates.some((candidate) => {
    const erpCap = normalizedNumeric(candidate.erp_cap);
    return erpCap !== null && Math.abs(erpCap - inputThickness) <= 0.2;
  });
}

function applyThicknessSignal(args: {
  score: number;
  why: string[];
  inputThickness: number | null;
  candidateThickness: number | null;
  label: string;
  exactBoost: number;
  nearestUpperBoost: number;
  upperCloseBoost: number;
  upperLooseBoost: number;
  belowPenalty: number;
}): { score: number; why: string[] } {
  const {
    score,
    why,
    inputThickness,
    candidateThickness,
    label,
    exactBoost,
    nearestUpperBoost,
    upperCloseBoost,
    upperLooseBoost,
    belowPenalty
  } = args;

  if (inputThickness === null || candidateThickness === null) {
    return { score, why };
  }

  const gap = Number((candidateThickness - inputThickness).toFixed(3));
  if (gap < 0) {
    return {
      score: score - belowPenalty,
      why: [...why, `${label} below requested`]
    };
  }

  if (gap === 0) {
    return {
      score: score + exactBoost,
      why: [...why, `${label} exact`]
    };
  }

  if (gap <= 2) {
    return {
      score: score + nearestUpperBoost,
      why: [...why, `${label} nearest upper`]
    };
  }

  if (gap <= 5) {
    return {
      score: score + upperCloseBoost,
      why: [...why, `${label} upper close`]
    };
  }

  if (gap <= 15) {
    return {
      score: score + upperLooseBoost,
      why: [...why, `${label} upper`]
    };
  }

  return { score, why };
}

function dimDistance(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return Number.POSITIVE_INFINITY;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.reduce((sum, v, i) => sum + Math.abs(v - sb[i]), 0);
}

function scoreSecondaryDimensions(
  input: number[],
  candidate: number[],
  options?: { strictSecondaryDims?: boolean }
): { delta: number; reasons: string[] } {
  const reasons: string[] = [];
  const strictSecondaryDims = options?.strictSecondaryDims === true;
  if (input.length === 0) {
    return { delta: 0, reasons };
  }

  if (candidate.length === 0) {
    return strictSecondaryDims
      ? { delta: -26, reasons: ["missing secondary dimensions"] }
      : { delta: 0, reasons };
  }

  const a = [...input].sort((x, y) => x - y);
  const b = [...candidate].sort((x, y) => x - y);
  let delta = 0;
  const compareCount = Math.min(a.length, b.length);

  for (let i = 0; i < compareCount; i += 1) {
    const gap = Math.abs(b[i] - a[i]);
    if (gap <= 3) {
      delta += 18;
      reasons.push("secondary dimension exact");
    } else if (gap <= 10) {
      delta += 10;
      reasons.push("secondary dimension near");
    } else if (gap <= 30) {
      delta += 2;
    } else if (gap <= 80) {
      delta -= 8;
      reasons.push("secondary dimension far");
    } else {
      delta -= 22;
      reasons.push("secondary dimension mismatch");
    }
  }

  if (candidate.length < input.length && strictSecondaryDims) {
    delta -= (input.length - candidate.length) * 10;
    reasons.push("secondary dimensions incomplete");
  }

  return { delta, reasons };
}

function directionalDimScore(input: number[], candidate: number[]): { delta: number; reasons: string[] } {
  const reasons: string[] = [];
  if (input.length === 0 || candidate.length === 0 || input.length !== candidate.length) {
    return { delta: 0, reasons };
  }

  const a = [...input].sort((x, y) => x - y);
  const b = [...candidate].sort((x, y) => x - y);
  let delta = 0;

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

function applyDelta(breakdown: ScoreBreakdown, key: keyof ScoreBreakdown["components"], delta: number): void {
  breakdown.components[key] += delta;
}

export function scoreCandidates(extracted: ExtractedFromInput, candidates: CandidateRow[], topK: number): ScoredResult[] {
  const inputDims = toInputDims(extracted);
  const inputThickness = inputDims.length > 0 ? [...inputDims].sort((a, b) => a - b)[0] : null;
  const inputSecondaryDims = inputDims.length > 1 ? [...inputDims].sort((a, b) => a - b).slice(1) : [];
  const preferAlvByThickness = inputThickness !== null && inputThickness <= 8;
  const exactErpCapExists = hasExactErpCapCandidate(candidates, inputThickness);

  const scored = candidates.map((c) => {
    let score = 0;
    const why: string[] = [];
    const breakdown = createBreakdown();
    const stockPrefix = getStockPrefix(c.stock_code);
    const shouldUseSecondaryDims = ["ABR", "ALM", "ACT", "AKP", "AKB"].includes(stockPrefix ?? "");

    if (extracted.series && c.series === extracted.series) {
      score += 40;
      applyDelta(breakdown, "series", 40);
      why.push("series exact");
    } else if (extracted.series_group && c.series_group === extracted.series_group) {
      score += 20;
      applyDelta(breakdown, "series", 20);
      why.push("series group match");
    }

    if (extracted.temper && c.temper && extracted.temper === c.temper) {
      score += 25;
      applyDelta(breakdown, "temper", 25);
      why.push("temper exact");
    }

    if (extracted.product_type && c.product_type && extracted.product_type === c.product_type) {
      score += 15;
      applyDelta(breakdown, "product_type", 15);
      why.push("product type exact");
    }

    if (extracted.dim_text && c.dim_text && extracted.dim_text === c.dim_text) {
      score += 25;
      applyDelta(breakdown, "dimensions", 25);
      why.push("dimensions exact");
    }

    const candDims = toCandidateDims(c);
    const distance = dimDistance(inputDims, candDims);
    if (Number.isFinite(distance)) {
      if (distance <= 3) {
        score += 22;
        applyDelta(breakdown, "dimensions", 22);
        why.push("dimensions tolerance <=3");
      } else if (distance <= 8) {
        score += 14;
        applyDelta(breakdown, "dimensions", 14);
        why.push("dimensions tolerance <=8");
      } else if (distance <= 20) {
        score += 6;
        applyDelta(breakdown, "dimensions", 6);
        why.push("dimensions near");
      }
    }

    const directional = directionalDimScore(inputDims, candDims);
    if (directional.delta !== 0) {
      score += directional.delta;
      applyDelta(breakdown, "dimensions", directional.delta);
      why.push(...directional.reasons);
    }

    const codeThickness = parseThicknessFromCode(c.stock_code);
    const nameThickness = parseMmFromName(c.stock_name);
    const dimensionalThickness = candDims.length > 0 ? [...candDims].sort((a, b) => a - b)[0] : null;
    const erpCapThickness = normalizedNumeric(c.erp_cap);
    const erpSecondaryDims = [normalizedNumeric(c.erp_en), normalizedNumeric(c.erp_boy), normalizedNumeric(c.erp_yukseklik)]
      .filter((value): value is number => value !== null);

    if (exactErpCapExists && inputThickness !== null) {
      if (erpCapThickness === null || Math.abs(erpCapThickness - inputThickness) > 0.2) {
        score -= 140;
        applyDelta(breakdown, "thickness", -140);
        why.push("exact erp cap candidate exists");
      }
    }

    const beforeErpCap = score;
    const afterErpCap = applyThicknessSignal({
      score,
      why,
      inputThickness,
      candidateThickness: erpCapThickness,
      label: "erp cap thickness",
      exactBoost: 56,
      nearestUpperBoost: 20,
      upperCloseBoost: 6,
      upperLooseBoost: 0,
      belowPenalty: 60
    });
    score = afterErpCap.score;
    applyDelta(breakdown, "thickness", score - beforeErpCap);
    why.splice(0, why.length, ...afterErpCap.why);

    if (inputThickness !== null && erpCapThickness === null) {
      score -= 22;
      applyDelta(breakdown, "thickness", -22);
      why.push("missing erp cap");
    }

    const secondaryDimensionScore = scoreSecondaryDimensions(inputSecondaryDims, erpSecondaryDims, {
      strictSecondaryDims: shouldUseSecondaryDims
    });
    if (secondaryDimensionScore.delta !== 0) {
      score += secondaryDimensionScore.delta;
      applyDelta(breakdown, "secondary_dimensions", secondaryDimensionScore.delta);
      why.push(...secondaryDimensionScore.reasons);
    }

    if (preferAlvByThickness) {
      if (stockPrefix === "ALV") {
        score += 18;
        applyDelta(breakdown, "stock_family", 18);
        why.push("thin stock prefers ALV");
      } else {
        score -= 6;
        applyDelta(breakdown, "stock_family", -6);
        why.push("thin stock non-ALV");
      }
    }

    const beforeCode = score;
    const afterCode = applyThicknessSignal({
      score,
      why,
      inputThickness,
      candidateThickness: codeThickness,
      label: "code thickness",
      exactBoost: 34,
      nearestUpperBoost: 30,
      upperCloseBoost: 18,
      upperLooseBoost: 8,
      belowPenalty: 48
    });
    score = afterCode.score;
    applyDelta(breakdown, "thickness", score - beforeCode);
    why.splice(0, why.length, ...afterCode.why);

    const beforeName = score;
    const afterName = applyThicknessSignal({
      score,
      why,
      inputThickness,
      candidateThickness: nameThickness,
      label: "name thickness",
      exactBoost: candDims.length === 0 ? 28 : 18,
      nearestUpperBoost: candDims.length === 0 ? 24 : 14,
      upperCloseBoost: candDims.length === 0 ? 14 : 8,
      upperLooseBoost: 4,
      belowPenalty: candDims.length === 0 ? 40 : 20
    });
    score = afterName.score;
    applyDelta(breakdown, "thickness", score - beforeName);
    why.splice(0, why.length, ...afterName.why);

    if (inputThickness !== null && dimensionalThickness !== null && nameThickness !== null && Math.abs(dimensionalThickness - nameThickness) <= 0.2) {
      score += 8;
      applyDelta(breakdown, "thickness", 8);
      why.push("name thickness confirms dimensions");
    }

    if (inputThickness !== null && codeThickness !== null && nameThickness !== null && Math.abs(codeThickness - nameThickness) <= 0.2) {
      score += 10;
      applyDelta(breakdown, "thickness", 10);
      why.push("code/name thickness aligned");
    }

    if (inputThickness !== null && erpCapThickness !== null && codeThickness !== null && Math.abs(erpCapThickness - codeThickness) <= 0.2) {
      score += 8;
      applyDelta(breakdown, "thickness", 8);
      why.push("erp cap/code aligned");
    }

    if (inputThickness !== null && erpCapThickness !== null && nameThickness !== null && Math.abs(erpCapThickness - nameThickness) <= 0.2) {
      score += 8;
      applyDelta(breakdown, "thickness", 8);
      why.push("erp cap/name aligned");
    }

    const trigram = Math.max(0, Math.min(1, c.similarity));
    if (trigram > 0) {
      const trigramScore = trigram * 10;
      score += trigramScore;
      applyDelta(breakdown, "text_similarity", trigramScore);
      why.push(`trigram ${trigramScore.toFixed(2)}`);
    }

    return {
      stock_id: c.stock_id,
      stock_code: c.stock_code,
      stock_name: c.stock_name,
      birim: c.birim ?? null,
      alasim: c.alasim ?? null,
      tamper: c.tamper ?? null,
      series: c.series ?? null,
      temper: c.temper ?? null,
      score: Number(score.toFixed(3)),
      why,
      hard_rule_pass: true,
      rule_hits: [],
      score_breakdown: breakdown
    };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

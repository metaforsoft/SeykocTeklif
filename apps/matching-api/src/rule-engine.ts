import { CandidateRow, ExtractedFromInput } from "@smp/common";

export interface MatchingRuleRecord {
  id: number;
  rule_set_id: number;
  rule_set_name: string;
  priority: number;
  rule_type: "hard_filter" | "soft_boost";
  target_level: "input" | "candidate" | "pair";
  condition_json: RuleCondition;
  effect_json: RuleEffect;
  stop_on_match: boolean;
  description: string | null;
}

export type RuleCondition =
  | { all: RuleCondition[] }
  | { any: RuleCondition[] }
  | { not: RuleCondition }
  | { field: string; op: string; value?: unknown };

export type RuleEffect =
  | { type: "require_prefix"; value: string }
  | { type: "require_exact_series" }
  | { type: "require_non_null"; field: string }
  | { type: "reject_prefix"; value: string }
  | { type: "reject_if_missing_dimension"; dimension: "thickness" | "secondary" | "any" };

export interface RuleAuditEntry {
  ruleId: number;
  candidateStockId: number | null;
  decision: "passed" | "rejected";
  deltaScore: number | null;
  reasonText: string;
}

export interface HardRuleEvaluation {
  candidates: CandidateRow[];
  candidateRuleHits: Map<number, string[]>;
  audits: RuleAuditEntry[];
}

function stockPrefix(code: string | null | undefined): string | null {
  if (!code) return null;
  const prefix = String(code).trim().split(".")[0]?.toUpperCase() ?? "";
  return prefix || null;
}

function resolveField(path: string, input: ExtractedFromInput, candidate: CandidateRow): unknown {
  const source = path.startsWith("input.")
    ? input as unknown as Record<string, unknown>
    : candidate as unknown as Record<string, unknown>;
  const normalizedPath = path.replace(/^(input|candidate)\./, "");
  return normalizedPath.split(".").reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, source);
}

function compareLeaf(fieldValue: unknown, op: string, expected: unknown): boolean {
  switch (op) {
    case "=":
      return fieldValue === expected;
    case "!=":
      return fieldValue !== expected;
    case ">":
      return Number(fieldValue) > Number(expected);
    case ">=":
      return Number(fieldValue) >= Number(expected);
    case "<":
      return Number(fieldValue) < Number(expected);
    case "<=":
      return Number(fieldValue) <= Number(expected);
    case "starts_with":
      return String(fieldValue ?? "").toUpperCase().startsWith(String(expected ?? "").toUpperCase());
    case "contains":
      return String(fieldValue ?? "").toLocaleLowerCase("tr-TR").includes(String(expected ?? "").toLocaleLowerCase("tr-TR"));
    case "exists":
      return fieldValue !== null && fieldValue !== undefined && String(fieldValue).trim() !== "";
    case "between": {
      const [minValue, maxValue] = Array.isArray(expected) ? expected : [undefined, undefined];
      const numeric = Number(fieldValue);
      return Number.isFinite(numeric) && numeric >= Number(minValue) && numeric <= Number(maxValue);
    }
    case "in":
      return Array.isArray(expected) && expected.includes(fieldValue);
    case "not_in":
      return Array.isArray(expected) && !expected.includes(fieldValue);
    default:
      return false;
  }
}

function matchesCondition(condition: RuleCondition, input: ExtractedFromInput, candidate: CandidateRow): boolean {
  if ("all" in condition) {
    return condition.all.every((item) => matchesCondition(item, input, candidate));
  }
  if ("any" in condition) {
    return condition.any.some((item) => matchesCondition(item, input, candidate));
  }
  if ("not" in condition) {
    return !matchesCondition(condition.not, input, candidate);
  }
  return compareLeaf(resolveField(condition.field, input, candidate), condition.op, condition.value);
}

function evaluateEffect(effect: RuleEffect, input: ExtractedFromInput, candidate: CandidateRow): { passed: boolean; reason: string } {
  switch (effect.type) {
    case "require_prefix": {
      const prefix = stockPrefix(candidate.stock_code);
      const wanted = String(effect.value ?? "").toUpperCase();
      const passed = prefix === wanted;
      return { passed, reason: passed ? `require_prefix ${wanted}` : `prefix must be ${wanted}` };
    }
    case "require_exact_series": {
      const passed = Boolean(input.series) && input.series === candidate.series;
      return { passed, reason: passed ? `require_exact_series ${input.series}` : `series must exactly match input` };
    }
    case "require_non_null": {
      const value = resolveField(effect.field, input, candidate);
      const passed = value !== null && value !== undefined && String(value).trim() !== "";
      return { passed, reason: passed ? `require_non_null ${effect.field}` : `${effect.field} is required` };
    }
    case "reject_prefix": {
      const prefix = stockPrefix(candidate.stock_code);
      const rejected = prefix === String(effect.value ?? "").toUpperCase();
      return { passed: !rejected, reason: rejected ? `prefix rejected ${effect.value}` : `reject_prefix ${effect.value} not matched` };
    }
    case "reject_if_missing_dimension": {
      const dims = [candidate.dim1, candidate.dim2, candidate.dim3].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      let missing = false;
      if (effect.dimension === "thickness") missing = dims.length < 1;
      else if (effect.dimension === "secondary") missing = dims.length < 2;
      else missing = dims.length === 0;
      return { passed: !missing, reason: missing ? `missing ${effect.dimension} dimension` : `${effect.dimension} dimension present` };
    }
    default:
      return { passed: true, reason: "unsupported effect ignored" };
  }
}

export function evaluateHardRules(input: ExtractedFromInput, candidates: CandidateRow[], rules: MatchingRuleRecord[]): HardRuleEvaluation {
  if (rules.length === 0) {
    return {
      candidates,
      candidateRuleHits: new Map(candidates.map((candidate) => [Number(candidate.stock_id), []])),
      audits: []
    };
  }

  const passingCandidates: CandidateRow[] = [];
  const candidateRuleHits = new Map<number, string[]>();
  const audits: RuleAuditEntry[] = [];

  for (const candidate of candidates) {
    let rejected = false;
    const hits: string[] = [];

    for (const rule of rules) {
      if (!matchesCondition(rule.condition_json, input, candidate)) {
        continue;
      }

      const decision = evaluateEffect(rule.effect_json, input, candidate);
      const label = rule.description?.trim() || `${rule.rule_set_name}#${rule.id}`;

      if (!decision.passed) {
        audits.push({
          ruleId: rule.id,
          candidateStockId: Number(candidate.stock_id),
          decision: "rejected",
          deltaScore: null,
          reasonText: `${label}: ${decision.reason}`
        });
        rejected = true;
        if (rule.stop_on_match || !decision.passed) {
          break;
        }
      }

      hits.push(`${label}: ${decision.reason}`);
      audits.push({
        ruleId: rule.id,
        candidateStockId: Number(candidate.stock_id),
        decision: "passed",
        deltaScore: null,
        reasonText: `${label}: ${decision.reason}`
      });
    }

    candidateRuleHits.set(Number(candidate.stock_id), hits);
    if (!rejected) {
      passingCandidates.push(candidate);
    }
  }

  return {
    candidates: passingCandidates,
    candidateRuleHits,
    audits
  };
}

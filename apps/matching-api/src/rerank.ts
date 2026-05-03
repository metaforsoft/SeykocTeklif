import { ScoredResult } from "@smp/common";
import { applyMlRerank } from "./ml";

const rerankServiceUrl = process.env["RERANK_SERVICE_URL"]?.trim() ?? "";

export async function rerankResults(inputText: string, results: ScoredResult[], topK: number): Promise<ScoredResult[]> {
  if (!rerankServiceUrl) {
    return applyMlRerank(results, topK);
  }

  try {
    const response = await fetch(rerankServiceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputText, results, topK })
    });

    if (!response.ok) {
      return applyMlRerank(results, topK);
    }

    const data = await response.json() as { results?: ScoredResult[] };
    if (!Array.isArray(data.results) || data.results.length === 0) {
      return applyMlRerank(results, topK);
    }

    const baseMap = new Map(results.map((item) => [Number(item.stock_id), item]));
    const merged = data.results.map((item) => {
      const base = baseMap.get(Number(item.stock_id));
      if (!base) return item;
      const richItem = item as ScoredResult & {
        alasim?: string | null;
        tamper?: string | null;
        series?: string | null;
        temper?: string | null;
        erp_cap?: number | null;
        erp_en?: number | null;
        erp_boy?: number | null;
        erp_yukseklik?: number | null;
        specific_gravity?: number | null;
        weight_formula?: string | null;
        scrap_formula?: string | null;
      };
      const richBase = base as ScoredResult & {
        alasim?: string | null;
        tamper?: string | null;
        series?: string | null;
        temper?: string | null;
        erp_cap?: number | null;
        erp_en?: number | null;
        erp_boy?: number | null;
        erp_yukseklik?: number | null;
        specific_gravity?: number | null;
        weight_formula?: string | null;
        scrap_formula?: string | null;
      };
      return {
        ...base,
        ...item,
        stock_code: item.stock_code ?? base.stock_code ?? null,
        stock_name: item.stock_name ?? base.stock_name ?? null,
        birim: item.birim ?? base.birim ?? null,
        erp_cap: richItem.erp_cap ?? richBase.erp_cap ?? null,
        erp_en: richItem.erp_en ?? richBase.erp_en ?? null,
        erp_boy: richItem.erp_boy ?? richBase.erp_boy ?? null,
        erp_yukseklik: richItem.erp_yukseklik ?? richBase.erp_yukseklik ?? null,
        specific_gravity: richItem.specific_gravity ?? richBase.specific_gravity ?? null,
        weight_formula: richItem.weight_formula ?? richBase.weight_formula ?? null,
        scrap_formula: richItem.scrap_formula ?? richBase.scrap_formula ?? null,
        alasim: richItem.alasim ?? richBase.alasim ?? null,
        tamper: richItem.tamper ?? richBase.tamper ?? null,
        series: richItem.series ?? richBase.series ?? null,
        temper: richItem.temper ?? richBase.temper ?? null
      };
    });

    return merged.slice(0, topK);
  } catch {
    return applyMlRerank(results, topK);
  }
}

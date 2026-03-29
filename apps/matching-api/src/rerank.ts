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

    return data.results.slice(0, topK);
  } catch {
    return applyMlRerank(results, topK);
  }
}

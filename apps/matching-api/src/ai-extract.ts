import { ParsedOrderDocument, ParsedOrderLine } from "@smp/common";

const googleVisionApiKey = process.env["GOOGLE_VISION_API_KEY"]?.trim() ?? "";
const openAiApiKey = process.env["OPENAI_API_KEY"]?.trim() ?? "";
const openAiModel = process.env["OPENAI_STRUCTURED_MODEL"]?.trim() || "gpt-4.1-mini";

function normalizeRawText(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function toFallbackDocument(doc: ParsedOrderDocument, method: string): ParsedOrderDocument {
  return { ...doc, extraction_method: method };
}

type TextExtractionResult = {
  text: string | null;
  error: string | null;
};

type LlmExtractionResult = {
  doc: ParsedOrderDocument | null;
  error: string | null;
};

export async function extractWithGoogleVision(buffer: Buffer): Promise<TextExtractionResult> {
  if (!googleVisionApiKey) return { text: null, error: "GOOGLE_VISION_API_KEY missing" };

  try {
    const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(googleVisionApiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        requests: [
          {
            image: { content: buffer.toString("base64") },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }]
          }
        ]
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      return { text: null, error: `vision_http_${response.status}: ${errorText.slice(0, 300)}` };
    }
    const payload = await response.json() as {
      responses?: Array<{
        fullTextAnnotation?: { text?: string };
        textAnnotations?: Array<{ description?: string }>;
        error?: { message?: string };
      }>;
    };
    const result = payload.responses?.[0];
    if (result?.error?.message) {
      return { text: null, error: result.error.message };
    }
    const text = result?.fullTextAnnotation?.text ?? result?.textAnnotations?.[0]?.description ?? "";
    return {
      text: text.trim() ? normalizeRawText(text) : null,
      error: text.trim() ? null : "vision_empty_text"
    };
  } catch (error) {
    return { text: null, error: error instanceof Error ? error.message : "vision_unknown_error" };
  }
}

function buildPrompt(ocrText: string, instruction?: string | null): string {
  return [
    "Siparis notundan tum teklif satiri alanlarini cikar.",
    "Sadece gercek siparis satirlarini dondur.",
    "Olculeri x ile normalize et. Olcu yoksa dimensions null degil bos string olabilir.",
    "Adet yoksa null dondur.",
    "Seri yoksa null dondur.",
    "Alasim/malzeme cinsi 5083, 6082 gibi seri veya 5083-TIRTIKLI gibi metin olabilir.",
    "Birim fiyat dogal dille fiyat, b.fiyat, bfiyat, tanesi, birimi, unit price gibi yazilabilir; yoksa null dondur.",
    "Musteri parca no; parca adi, parca no, referans, musteri parca gibi yazilabilir.",
    "Musteri no; cari no, musteri kodu, customer no gibi yazilabilir.",
    "Kesim ve mensei bilgisi varsa dondur, yoksa null.",
    instruction ? `Kullanici talimati: ${instruction}` : "",
    "Ham OCR metni:",
    ocrText
  ].filter(Boolean).join("\n");
}

export async function extractWithLlmFallback(ocrText: string, sourceType: ParsedOrderDocument["source_type"], instruction?: string | null): Promise<LlmExtractionResult> {
  if (!openAiApiKey) return { doc: null, error: "OPENAI_API_KEY missing" };
  if (!ocrText.trim()) return { doc: null, error: "llm_text_input_empty" };

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiApiKey}`
      },
      body: JSON.stringify({
        model: openAiModel,
        messages: [
          {
            role: "system",
            content: "Ciktin yalnizca gecerli JSON olsun. Siparis satirlarini dimensions, qty, series, raw alanlari ile cikar."
          },
          {
            role: "user",
            content: buildPrompt(ocrText, instruction)
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "order_lines",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                header_context: { type: ["string", "null"] },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      raw: { type: "string" },
                      dimensions: { type: "string" },
                      qty: { type: ["number", "null"] },
                      series: { type: ["string", "null"] },
                      alasim: { type: ["string", "null"] },
                      temper: { type: ["string", "null"] },
                      kg: { type: ["number", "null"] },
                      birimFiyat: { type: ["number", "null"] },
                      talasMik: { type: ["number", "null"] },
                      musteriNo: { type: ["string", "null"] },
                      musteriParcaNo: { type: ["string", "null"] },
                      kesimDurumu: { type: ["string", "null"] },
                      mensei: { type: ["string", "null"] }
                    },
                    required: ["raw", "dimensions", "qty", "series", "alasim", "temper", "kg", "birimFiyat", "talasMik", "musteriNo", "musteriParcaNo", "kesimDurumu", "mensei"]
                  }
                }
              },
              required: ["header_context", "items"]
            }
          }
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { doc: null, error: `openai_http_${response.status}: ${errorText.slice(0, 300)}` };
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return { doc: null, error: "llm_text_empty_content" };
    const parsed = JSON.parse(content) as {
      header_context: string | null;
      items: Array<{
        raw: string;
        dimensions: string;
        qty: number | null;
        series: string | null;
        alasim?: string | null;
        temper?: string | null;
        kg?: number | null;
        birimFiyat?: number | null;
        talasMik?: number | null;
        musteriNo?: string | null;
        musteriParcaNo?: string | null;
        kesimDurumu?: string | null;
        mensei?: string | null;
      }>;
    };

    const lines = parsed.items
      .map((item): ParsedOrderLine | null => {
        const dimParts = item.dimensions.split(/[xX*]/).map((part) => Number(part.trim())).filter((n) => Number.isFinite(n));
        if (dimParts.length < 2) return null;
        const sorted = [...dimParts].sort((a, b) => a - b);
        return {
          raw: item.raw,
          query: [parsed.header_context, item.raw].filter(Boolean).join(" ").trim(),
          normalized_line: item.raw,
          dim_text: sorted.join("x"),
          dim1: sorted[0] ?? null,
          dim2: sorted[1] ?? null,
          dim3: sorted[2] ?? null,
          qty: item.qty,
          series: item.series,
          alasim: item.alasim ?? item.series ?? null,
          temper: item.temper ?? null,
          kg: item.kg ?? null,
          birimFiyat: item.birimFiyat ?? null,
          talasMik: item.talasMik ?? null,
          musteriNo: item.musteriNo ?? null,
          musteriParcaNo: item.musteriParcaNo ?? null,
          kesimDurumu: item.kesimDurumu ?? null,
          mensei: item.mensei ?? null,
          header_context: parsed.header_context,
          confidence: 0.92
        };
      })
      .filter((item): item is ParsedOrderLine => item !== null);

    return { doc: {
      source_type: sourceType,
      extracted_text: ocrText,
      header_context: parsed.header_context,
      items: lines,
      parser_confidence: lines.length > 0 ? 0.92 : 0,
      extraction_method: "llm_fallback"
    }, error: lines.length > 0 ? null : "llm_text_no_valid_items" };
  } catch (error) {
    return { doc: null, error: error instanceof Error ? error.message : "llm_text_unknown_error" };
  }
}

export async function extractWithLlmImageFallback(
  buffer: Buffer,
  sourceType: ParsedOrderDocument["source_type"],
  mimeType = "image/jpeg",
  instruction?: string | null
): Promise<LlmExtractionResult> {
  if (!openAiApiKey) return { doc: null, error: "OPENAI_API_KEY missing" };

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiApiKey}`
      },
      body: JSON.stringify({
        model: openAiModel,
        messages: [
          {
            role: "system",
            content: "Gorseldeki siparis satirlarini cikar. Ciktin yalnizca gecerli JSON olsun. Siparis satirlarini dimensions, qty, series, raw alanlari ile dondur."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  "Gorselde sadece gercek siparis satirlarini bul.",
                  "Whatsapp arayuzu ve sohbet mesajlarini yok say.",
                  "Olculeri x ile normalize et.",
                  "Seri yoksa null dondur.",
                  instruction ? `Kullanici talimati: ${instruction}` : ""
                ].filter(Boolean).join(" ")
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${buffer.toString("base64")}`
                }
              }
            ]
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "order_lines_from_image",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                header_context: { type: ["string", "null"] },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      raw: { type: "string" },
                      dimensions: { type: "string" },
                      qty: { type: ["number", "null"] },
                      series: { type: ["string", "null"] },
                      alasim: { type: ["string", "null"] },
                      temper: { type: ["string", "null"] },
                      kg: { type: ["number", "null"] },
                      birimFiyat: { type: ["number", "null"] },
                      talasMik: { type: ["number", "null"] },
                      musteriNo: { type: ["string", "null"] },
                      musteriParcaNo: { type: ["string", "null"] },
                      kesimDurumu: { type: ["string", "null"] },
                      mensei: { type: ["string", "null"] }
                    },
                    required: ["raw", "dimensions", "qty", "series", "alasim", "temper", "kg", "birimFiyat", "talasMik", "musteriNo", "musteriParcaNo", "kesimDurumu", "mensei"]
                  }
                }
              },
              required: ["header_context", "items"]
            }
          }
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { doc: null, error: `openai_http_${response.status}: ${errorText.slice(0, 300)}` };
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return { doc: null, error: "llm_image_empty_content" };
    const parsed = JSON.parse(content) as {
      header_context: string | null;
      items: Array<{
        raw: string;
        dimensions: string;
        qty: number | null;
        series: string | null;
        alasim?: string | null;
        temper?: string | null;
        kg?: number | null;
        birimFiyat?: number | null;
        talasMik?: number | null;
        musteriNo?: string | null;
        musteriParcaNo?: string | null;
        kesimDurumu?: string | null;
        mensei?: string | null;
      }>;
    };

    const lines = parsed.items
      .map((item): ParsedOrderLine | null => {
        const dimParts = item.dimensions.split(/[xX*]/).map((part) => Number(part.trim())).filter((n) => Number.isFinite(n));
        if (dimParts.length < 2) return null;
        const sorted = [...dimParts].sort((a, b) => a - b);
        return {
          raw: item.raw,
          query: [parsed.header_context, item.raw].filter(Boolean).join(" ").trim(),
          normalized_line: item.raw,
          dim_text: sorted.join("x"),
          dim1: sorted[0] ?? null,
          dim2: sorted[1] ?? null,
          dim3: sorted[2] ?? null,
          qty: item.qty,
          series: item.series,
          alasim: item.alasim ?? item.series ?? null,
          temper: item.temper ?? null,
          kg: item.kg ?? null,
          birimFiyat: item.birimFiyat ?? null,
          talasMik: item.talasMik ?? null,
          musteriNo: item.musteriNo ?? null,
          musteriParcaNo: item.musteriParcaNo ?? null,
          kesimDurumu: item.kesimDurumu ?? null,
          mensei: item.mensei ?? null,
          header_context: parsed.header_context,
          confidence: 0.95
        };
      })
      .filter((item): item is ParsedOrderLine => item !== null);

    return { doc: {
      source_type: sourceType,
      extracted_text: "",
      header_context: parsed.header_context,
      items: lines,
      parser_confidence: lines.length > 0 ? 0.95 : 0,
      extraction_method: "llm_image_fallback"
    }, error: lines.length > 0 ? null : "llm_image_no_valid_items" };
  } catch (error) {
    return { doc: null, error: error instanceof Error ? error.message : "llm_image_unknown_error" };
  }
}

export function parserNeedsFallback(doc: ParsedOrderDocument): boolean {
  if (doc.items.length === 0) return true;
  if (doc.parser_confidence < 0.72) return true;
  const hasQtyOrSeries = doc.items.some((item) => item.qty !== null || Boolean(item.series));
  return !hasQtyOrSeries;
}

export function annotateMethod(doc: ParsedOrderDocument, method: string): ParsedOrderDocument {
  return toFallbackDocument(doc, method);
}

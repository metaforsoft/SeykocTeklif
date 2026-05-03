import { createHash } from "node:crypto";
import { InstructionPolicyPayload, MatchPolicy, RowInstructionCommand, RowInstructionSet } from "@smp/common";
import { matchPool } from "@smp/db";
import { ExtractionFingerprint } from "./extraction-learning";

const openAiApiKey = process.env["OPENAI_API_KEY"]?.trim() ?? "";
const openAiModel = process.env["OPENAI_STRUCTURED_MODEL"]?.trim() || "gpt-4o";

export interface ParsedInstructionPlan {
  rawMessage: string;
  sanitizedMessage: string;
  rowCommands: RowInstructionCommand[];
  ignoredRowCommands: Array<{ reason: string; rowNumber?: number }>;
  extractionPrompt: string | null;
  matchPolicy: MatchPolicy | null;
  rowDefaults: RowInstructionSet | null;
  needsReextract: boolean;
  needsRematch: boolean;
  learnable: boolean;
  /** Yeni kural önizlemesi: intent=new_rule ise dolu gelir, UI onay ister */
  rulePreview?: {
    ruleType: "hard_filter" | "soft_boost";
    scopeType: "global" | "customer";
    scopeValue: string | null;
    description: string;
    isLocked: boolean;
    conditionJson: Record<string, unknown>;
    effectJson: Record<string, unknown>;
  } | null;
}

interface StoredInstructionPolicy {
  id: number;
  name: string;
  policy_json: InstructionPolicyPayload;
  similarity: number;
  success_count: number;
  use_count: number;
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/ı/g, "i")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    
    .trim();
}

function normalizeJson<T extends Record<string, unknown>>(value: T): T {
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key as keyof T] = value[key] as T[keyof T];
    return acc;
  }, {} as T);
}

function hashPolicy(policy: InstructionPolicyPayload): string {
  return createHash("sha256").update(JSON.stringify(normalizeJson(policy as Record<string, unknown>))).digest("hex");
}

function extractInstructionSet(text: string): RowInstructionSet {
  const normalized = normalizeText(text);
  if (!normalized) return {};

  const set: RowInstructionSet = {};
  const kesimVarIndex = Math.max(normalized.lastIndexOf("kesim var"), normalized.lastIndexOf("kemim var"));
  const kesimYokIndex = Math.max(normalized.lastIndexOf("kesim yok"), normalized.lastIndexOf("kemim yok"));
  if (kesimVarIndex >= 0 || kesimYokIndex >= 0) {
    set.kesimDurumu = kesimYokIndex > kesimVarIndex ? "Kesim Yok" : "Kesim Var";
  }

  const mentionsMensei = normalized.includes("menşei") || normalized.includes("mensei");
  const hasContext = normalized.includes("satirlar") || normalized.includes("tum") || normalized.includes("hepsi");
  if (mentionsMensei || hasContext) {
    if (normalized.includes("yerli")) set.mensei = "YERLİ";
    else if (normalized.includes("ithal")) set.mensei = "İTHAL";
  }

  const adetMatch = normalized.match(/adet\s*(?:=|:)?\s*(\d+)/i) || normalized.match(/(\d+)\s*adet/i);
  if (adetMatch) {
    const quantity = Number(adetMatch[1]);
    if (Number.isFinite(quantity) && quantity > 0) {
      set.quantity = quantity;
    }
  }

  return set;
}

function parseRowCommands(message: string, rowCount: number): {
  commands: RowInstructionCommand[];
  ignored: Array<{ reason: string; rowNumber?: number }>;
} {
  const normalized = normalizeText(message);
  if (!normalized) {
    return { commands: [], ignored: [] };
  }

  const rowRefPattern = /(\d+)\.\s*sat[ıi]r(?:ı|i|a|e|da|de|daki|deki|icin|için)?/g;
  const rowRefs = [...normalized.matchAll(rowRefPattern)];
  const commands: RowInstructionCommand[] = [];
  const ignored: Array<{ reason: string; rowNumber?: number }> = [];

  if (rowRefs.length === 0) {
    const globalSet = extractInstructionSet(normalized);
    if (Object.keys(globalSet).length > 0) {
      commands.push({ scope: "all", set: globalSet });
    }
    return { commands, ignored };
  }

  const segments: Array<[number, number]> = [];
  rowRefs.forEach((match, index) => {
    const rowIndex = Number(match[1]) - 1;
    const clauseStart = (match.index ?? 0) + match[0].length;
    const clauseEnd = index + 1 < rowRefs.length ? (rowRefs[index + 1].index ?? normalized.length) : normalized.length;
    const clause = normalized.slice(clauseStart, clauseEnd).trim();
    const set = extractInstructionSet(clause);

    if (!Object.keys(set).length) {
      ignored.push({ reason: "empty", rowNumber: rowIndex + 1 });
    } else if (rowIndex < 0 || rowIndex >= rowCount) {
      ignored.push({ reason: "row-out-of-range", rowNumber: rowIndex + 1 });
    } else {
      commands.push({
        scope: "row",
        rowIndex,
        rowNumber: rowIndex + 1,
        set
      });
    }

    segments.push([match.index ?? 0, clauseEnd]);
  });

  let remaining = normalized;
  segments.sort((a, b) => b[0] - a[0]).forEach(([start, end]) => {
    remaining = `${remaining.slice(0, start)} ${remaining.slice(end)}`;
  });

  const globalSet = extractInstructionSet(remaining);
  if (Object.keys(globalSet).length > 0) {
    commands.unshift({ scope: "all", set: globalSet });
  }

  return { commands, ignored };
}

export function parseMatchPolicy(instruction: string | undefined | null): MatchPolicy | null {
  const normalized = normalizeText(instruction ?? "");
  if (!normalized) return null;

  const prefixMatch = normalized.match(/\b([a-z0-9._-]{2,12})\s+ile baslayan(?:\s+stok(?:lar|lari|larda)?)?(?:\s+(?:ara|getir|goster|esle|eşle))?\b/)
    || normalized.match(/\bstok\s*kod(?:u|unda)?\s+([a-z0-9._-]{2,12})\s+ile baslayan(?:larda|lar|lari)?(?:\s+(?:ara|getir|goster|esle|eşle))?\b/i);
  const seriesPatterns = [
    /\b([1-9]\d{3})\s+(?:gecen|serisini|serisi|seri)\b/,
    /\b([1-9]\d{3})\s+serisinde\b/,
    /\b([1-9]\d{3})\s+serisinde\s+(?:ara|getir|goster)\b/,
    /\b([1-9]\d{3})\s+serisine\b/,
    /\b(?:alasimi|serisi|seri)\s+([1-9]\d{3})\b/,
    /\b([1-9]\d{3})\s+serisine\s+(?:bak|gore|göre)\b/,
    /\b(?:alasim|alaşim)\s+([1-9]\d{3})\b/,
    /\b([1-9]\d{3})\s+(?:lerde|larda|olanlar|olanlari|olanları)\b/,
    /\bsadece\s+([1-9]\d{3})\s+stoklarda\b/,
    /\b([1-9]\d{3})\s+(?:stoklarda|stoklarda ara|lerde ara|larda ara)\b/,
    /\b([1-9]\d{3})\s+(?:icin|için)\s+ara\b/,
    /\b([1-9]\d{3})\s+(?:getir|ara|goster|göster)\b/
  ];
  const seriesMatch = seriesPatterns.map((pattern) => normalized.match(pattern)).find(Boolean) ?? null;
  const temperPatterns = [
    /\btamper\s*(?:=|:)?\s*(t\d{1,4}|h\d{1,4}|o|f)\b/i,
    /\btamperi?\s*(?:=|:)?\s*(t\d{1,4}|h\d{1,4}|o|f)\b/i,
    /\b(t\d{1,4}|h\d{1,4}|o|f)\s+(?:temperde|tempere|temper|durumunda)\b/i,
    /\btemper\s+(t\d{1,4}|h\d{1,4}|o|f)\b/i,
    /\btemperi?\s+(t\d{1,4}|h\d{1,4}|o|f)\b/i,
    /\b(t\d{1,4}|h\d{1,4}|o|f)\s+tamper\b/i,
    /\b(t\d{1,4}|h\d{1,4}|o|f)\s+(?:olanlar|olanlari|olanları|getir|ara)\b/i
  ];
  const temperMatch = temperPatterns.map((pattern) => normalized.match(pattern)).find(Boolean) ?? null;
  const dim1Match = normalized.match(/\b(?:kalinlik|kalınlık)\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)\b/i);
  const dim2Match = normalized.match(/\ben\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)\b/i);
  const dim3Match = normalized.match(/\bboy\s*(?:=|:)?\s*(\d+(?:[.,]\d+)?)\b/i);
  const stockCodeContainsMatch = normalized.match(/\bstok\s*kod(?:u|unda)?\s+([a-z0-9._-]{2,30})\s+(?:gecen|geçen|gecsin|geçsin|olsun)(?:lerde|larda)?\b/i)
    || normalized.match(/\b([a-z0-9._-]{2,30})\s+(?:gecen|geçen|gecsin|geçsin)(?:lerde|larda)?\s+stok\s*kod(?:u|unda)?\b/i);
  const stockNameContainsMatch = normalized.match(/\bstok\s*ad(?:i|ı|inda|ında)?\s+(.+?)\s+(?:gecen|geçen|gecsin|geçsin|olsun)(?:lerde|larda)?\b/i)
    || normalized.match(/\b(.+?)\s+(?:gecen|geçen|gecsin|geçsin)(?:lerde|larda)?\s+stok\s*ad(?:i|ı|inda|ında)?\b/i);
  const stockCodeActionMatch = normalized.match(/\bstok\s*kod(?:u|unda)?\s+([a-z0-9._-]{2,30})\s+(?:gecsin|geçsin|olsun)\b/i);
  const stockNameActionMatch = normalized.match(/\bstok\s*ad(?:i|ı|inda|ında)?\s+(.+?)\s+(?:gecsin|geçsin|olsun)\b/i);
  const productTypePatterns: Array<{ pattern: RegExp; value: string }> = [
    { pattern: /\bboru\b/, value: "BORU" },
    { pattern: /\bprofil\b/, value: "PROFIL" },
    { pattern: /\blama\b/, value: "LAMA" },
    { pattern: /\bsac\b/, value: "SAC" },
    { pattern: /\bkosebent\b|\bköşebent\b/, value: "KOSEBENT" },
    { pattern: /\bmil\b/, value: "MIL" },
    { pattern: /\bplaka\b/, value: "PLAKA" }
  ];
  const preferredProductType = productTypePatterns.find((item) => item.pattern.test(normalized))?.value ?? null;
  const quotedTerms = [...normalized.matchAll(/["”“']([^"”“']{2,40})["”“']/g)].map((match) => match[1].trim());
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
    /\balasim\s+bos\s+olamaz\b/i.test(normalized) || /\balaşim\s+bos\s+olamaz\b/i.test(normalized) ? "alasim" : null,
    /\bstok\s*kodu\s+bos\s+olamaz\b/i.test(normalized) ? "stock_code" : null,
    /\bstok\s*adi\s+bos\s+olamaz\b/i.test(normalized) || /\bstok\s*adı\s+bos\s+olamaz\b/i.test(normalized) ? "stock_name" : null,
    /\bkalinlik\s+bos\s+olamaz\b/i.test(normalized) || /\bkalınlık\s+bos\s+olamaz\b/i.test(normalized) ? "dim1" : null,
    /\ben\s+bos\s+olamaz\b/i.test(normalized) ? "dim2" : null,
    /\bboy\s+bos\s+olamaz\b/i.test(normalized) ? "dim3" : null
  ].filter((value): value is string => Boolean(value));

  const policy: MatchPolicy = {
    stockCodePrefix: prefixMatch?.[1]?.toUpperCase() ?? null,
    requiredTerms,
    requiredStockCodeTerms,
    requiredStockNameTerms,
    requiredNonEmptyFields,
    preferredSeries: seriesMatch?.[1] ?? null,
    preferredTemper: temperMatch?.[1]?.toUpperCase() ?? null,
    preferredProductType,
    preferredDim1: dim1Match ? Number(dim1Match[1].replace(',', '.')) : null,
    preferredDim2: dim2Match ? Number(dim2Match[1].replace(',', '.')) : null,
    preferredDim3: dim3Match ? Number(dim3Match[1].replace(',', '.')) : null
  };

  if (!policy.stockCodePrefix
    && !policy.preferredSeries
    && !policy.preferredTemper
    && !policy.preferredProductType
    && policy.preferredDim1 == null
    && policy.preferredDim2 == null
    && policy.preferredDim3 == null
    && requiredTerms.length === 0
    && requiredStockCodeTerms.length === 0
    && requiredStockNameTerms.length === 0
    && requiredNonEmptyFields.length === 0) {
    return null;
  }

  return policy;
}

function parseExpectedItemCount(message: string): number | null {
  const match = message.match(/(\d{1,2})\s*(?:satir|satır|olcu|ölçü|kalem)/i);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isFinite(count) && count > 0 ? count : null;
}

interface LlmRulePlan {
  ruleType: "hard_filter" | "soft_boost";
  scopeType: "global" | "customer";
  scopeValue: string | null; // cari kodu veya cari adı
  description: string;
  condition: Record<string, unknown>;
  effect: Record<string, unknown>;
  isLocked: boolean; // true ise chat prompt'u bu kuralı ezemez
}

interface LlmInstructionResult {
  intent: "match_filter" | "extraction_hint" | "row_update" | "rerun" | "new_rule" | "unknown";
  matchPolicy: MatchPolicy | null;
  extractionPrompt: string | null;
  rowCommands: RowInstructionCommand[];
  rule: LlmRulePlan | null;
  needsRematch: boolean;
  needsReextract: boolean;
  explanation: string;
}

async function parseInstructionWithLlm(message: string, rowCount: number): Promise<LlmInstructionResult | null> {
  if (!openAiApiKey) return null;
  if (!message.trim()) return null;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiApiKey}`
      },
      body: JSON.stringify({
        model: openAiModel,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: [
              "Sen bir alüminyum/metal stok eşleştirme platformunun talimat çözümleyicisisin.",
              "Kullanıcı Türkçe doğal dilde çeşitli talimatlar verir. Talimatı analiz edip doğru JSON çıktısını döndür.",
              "",
              "## Talimat Türleri ve intent Değerleri",
              "",
              "### 1. match_filter — Stok arama/filtreleme talimatları",
              "Kullanıcı eşleştirme sonuçlarını filtrelemek veya belirli stoklarda aramak istiyor.",
              "matchPolicy alanlarını doldur:",
              "- stockCodePrefix: Stok kodu belirli önekle başlasın (örn: 'APL', 'ACB')",
              "- requiredTerms: Stok kodu veya adında geçmesi gereken terimler (büyük harf)",
              "- requiredStockCodeTerms: Sadece stok kodunda geçmesi gereken terimler (büyük harf)",
              "- requiredStockNameTerms: Sadece stok adında geçmesi gereken terimler",
              "- preferredSeries: Alaşım serisi (4 haneli, örn: '5083', '6061')",
              "- preferredTemper: Tamper/temper durumu (örn: 'H321', 'T6', 'HO', 'O', 'F')",
              "- preferredProductType: Ürün tipi (PLAKA, BORU, PROFIL, LAMA, SAC, MIL, KOSEBENT, CUBUK)",
              "- preferredDim1: Kalınlık/çap (mm)",
              "- preferredDim2: En (mm)",
              "- preferredDim3: Boy (mm)",
              "needsRematch: true",
              "",
              "Örnekler:",
              "- 'apl olan stoklarda ara' → intent: match_filter, requiredStockCodeTerms: ['APL']",
              "- 'plaka stoklarda ara' → intent: match_filter, preferredProductType: 'PLAKA'",
              "- 'apl ile başlayan stoklarda ara' → intent: match_filter, stockCodePrefix: 'APL'",
              "",
              "### 2. extraction_hint — Belge/doküman çözümleme talimatları",
              "Excel kolon adları, alanların nasıl parse edileceği, veri çıkarma ipuçları.",
              "extractionPrompt alanına kullanıcının talimatını aynen yaz.",
              "needsReextract: true, needsRematch: true",
              "",
              "Örnekler:",
              "- 'exceldeki miktar alanı mik.' → intent: extraction_hint, extractionPrompt: 'exceldeki miktar alanı mik.'",
              "- 'kalınlık kolonu X Yönü' → intent: extraction_hint, extractionPrompt: 'kalınlık kolonu X Yönü'",
              "- '3 satır sipariş var' → intent: extraction_hint, extractionPrompt: '3 satır sipariş var'",
              "- 'boy alanı uzunluk kolonu' → intent: extraction_hint, extractionPrompt: 'boy alanı uzunluk kolonu'",
              "",
              "### 3. row_update — Satır düzenleme talimatları",
              "Belirli satırlar veya tüm satırlar için kesim durumu, menşei, adet gibi özellik değişiklikleri.",
              "rowCommands dizisine komutları ekle.",
              "scope: 'all' (tüm satırlar) veya 'row' (belirli satır, rowIndex: 0-based, rowNumber: 1-based)",
              "set içinde: kesimDurumu ('Kesim Var' veya 'Kesim Yok'), mensei ('YERLİ' veya 'İTHAL'), quantity (sayı)",
              "needsRematch: false, needsReextract: false",
              "",
              "Örnekler:",
              "- 'tüm satırlar kesim yok' → intent: row_update, rowCommands: [{scope:'all', set:{kesimDurumu:'Kesim Yok'}}]",
              "- '3. satır kesim yok' → intent: row_update, rowCommands: [{scope:'row', rowIndex:2, rowNumber:3, set:{kesimDurumu:'Kesim Yok'}}]",
              "- 'hepsi ithal' → intent: row_update, rowCommands: [{scope:'all', set:{mensei:'İTHAL'}}]",
              "- '5. satır 10 adet' → intent: row_update, rowCommands: [{scope:'row', rowIndex:4, rowNumber:5, set:{quantity:10}}]",
              "",
              "### 4. rerun — Yeniden analiz/eşleştirme talimatları",
              "Kullanıcı mevcut verileri yeniden analiz etmek veya eşleştirmek istiyor.",
              "needsRematch: true",
              "",
              "Örnekler:",
              "- 'yeniden eşleştir' → intent: rerun",
              "- 'tekrar ara' → intent: rerun",
              "",
              "### 5. new_rule — Admin kural tanımlama",
              "Kullanıcı yeni bir eşleştirme kuralı tanımlıyor.",
              "rule alanını doldur:",
              "- ruleType: 'hard_filter' (stok elenir) veya 'soft_boost' (puan etkisi)",
              "- scopeType: 'global' (herkese) veya 'customer' (belirli cari için)",
              "- scopeValue: cari kodu veya cari adı (customer scope ise), aksi null",
              "- description: Türkçe kural açıklaması",
              "- isLocked: true ise chat'ten override edilemez (genellikle hard kurallar için true)",
              "- condition: JSON kural koşulu ({field, op, value} veya {all:[...]} formatında)",
              "- effect: JSON kural etkisi ({type, value} formatında)",
              "",
              "Desteklenen condition field'lar: input.dim1 (kalınlık), input.dim2 (en), input.dim3 (boy), input.series (alaşım), input.temper, candidate.series, candidate.temper, candidate.stock_code",
              "Desteklenen op'lar: =, !=, >, >=, <, <=, between, exists, starts_with, in, not_in",
              "Desteklenen hard effect type'lar: require_prefix, reject_prefix, require_exact_series, reject_if_missing_dimension",
              "Desteklenen soft effect type'lar: add_score (value: sayı), multiply_score",
              "",
              "Örnekler:",
              "- 'kalınlık 0-8 ise ALV ile başlamalı' → hard_filter, global, condition: {all:[{field:'input.dim1',op:'>=',value:0},{field:'input.dim1',op:'<=',value:8}]}, effect: {type:'require_prefix',value:'ALV'}",
              "- 'alaşım 7075 ise tam eşleşme zorunlu' → hard_filter, global, condition: {field:'input.series',op:'=',value:'7075'}, effect: {type:'require_exact_series'}",
              "- 'CARİ-001 için 5083 veya 5086 serisine +15 puan' → soft_boost, customer, scopeValue: 'CARİ-001', condition: {any:[{field:'candidate.series',op:'=',value:'5083'},{field:'candidate.series',op:'=',value:'5086'}]}, effect: {type:'add_score',value:15}",
              "- 'H321 tamper olanları öne al' → soft_boost, global, condition: {field:'candidate.temper',op:'=',value:'H321'}, effect: {type:'add_score',value:12}",
              "",
              "### 6. unknown — Anlaşılamayan talimatlar",
              "Talimat yukarıdaki kategorilere uymuyorsa intent: 'unknown' döndür.",
              "",
              "## Genel Kurallar",
              "- Sadece talimattan çıkarılabilen alanları doldur.",
              "- Boş/null kalması gereken alanları null veya boş dizi bırak.",
              "- explanation alanına talimatın nasıl anlaşıldığını Türkçe kısaca yaz.",
              `- Tabloda şu an ${rowCount} satır var. Satır numaraları 1'den başlar.`
            ].join("\n")
          },
          {
            role: "user",
            content: message
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "instruction_plan",
            strict: false,
            schema: {
              type: "object",
              properties: {
                intent: {
                  type: "string",
                  enum: ["match_filter", "extraction_hint", "row_update", "rerun", "new_rule", "unknown"]
                },
                explanation: { type: "string" },
                needsRematch: { type: "boolean" },
                needsReextract: { type: "boolean" },
                extractionPrompt: { type: ["string", "null"] },
                matchPolicy: {
                  type: ["object", "null"],
                  additionalProperties: false,
                  properties: {
                    stockCodePrefix: { type: ["string", "null"] },
                    requiredTerms: { type: "array", items: { type: "string" } },
                    requiredStockCodeTerms: { type: "array", items: { type: "string" } },
                    requiredStockNameTerms: { type: "array", items: { type: "string" } },
                    preferredSeries: { type: ["string", "null"] },
                    preferredTemper: { type: ["string", "null"] },
                    preferredProductType: { type: ["string", "null"] },
                    preferredDim1: { type: ["number", "null"] },
                    preferredDim2: { type: ["number", "null"] },
                    preferredDim3: { type: ["number", "null"] }
                  },
                  required: [
                    "stockCodePrefix", "requiredTerms", "requiredStockCodeTerms",
                    "requiredStockNameTerms", "preferredSeries", "preferredTemper",
                    "preferredProductType", "preferredDim1", "preferredDim2", "preferredDim3"
                  ]
                },
                rowCommands: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      scope: { type: "string", enum: ["all", "row"] },
                      rowIndex: { type: ["integer", "null"] },
                      rowNumber: { type: ["integer", "null"] },
                      set: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          kesimDurumu: { type: ["string", "null"], enum: ["Kesim Var", "Kesim Yok", null] },
                          mensei: { type: ["string", "null"], enum: ["YERLİ", "İTHAL", null] },
                          quantity: { type: ["number", "null"] }
                        },
                        required: ["kesimDurumu", "mensei", "quantity"]
                      }
                    },
                    required: ["scope", "rowIndex", "rowNumber", "set"]
                  }
                },
                rule: {
                  type: ["object", "null"],
                  properties: {
                    ruleType: { type: "string", enum: ["hard_filter", "soft_boost"] },
                    scopeType: { type: "string", enum: ["global", "customer"] },
                    scopeValue: { type: ["string", "null"] },
                    description: { type: "string" },
                    isLocked: { type: "boolean" },
                    condition: { type: "object" },
                    effect: { type: "object" }
                  },
                  required: ["ruleType", "scopeType", "scopeValue", "description", "isLocked", "condition", "effect"]
                }
              },
              required: ["intent", "explanation", "needsRematch", "needsReextract", "extractionPrompt", "matchPolicy", "rowCommands", "rule"]
            }
          }
        }
      })
    });

    if (!response.ok) return null;

    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as LlmInstructionResult;
    if (parsed.intent === "unknown") return null;

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Yalnızca kural tanımlama odaklı LLM çağrısı.
 * /admin/rules/plan endpoint'i bu fonksiyonu kullanır.
 * Tüm girdiler kural tanımı olarak değerlendirilir.
 */
export async function parseRuleDefinitionWithLlm(message: string): Promise<LlmRulePlan | null> {
  if (!openAiApiKey) return null;
  if (!message.trim()) return null;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiApiKey}`
      },
      body: JSON.stringify({
        model: openAiModel,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: [
              "Sen bir alüminyum/metal stok eşleştirme platformunun kural tanımlama asistanısın.",
              "Kullanıcı doğal dilde bir kural tanımlıyor. Bu metni JSON kural şemasına çevir.",
              "HER ZAMAN bir kural üret. Kullanıcının yazdığı metin kesinlikle bir kural tanımıdır.",
              "",
              "## Kural Şeması",
              "",
              "### ruleType",
              "- hard_filter: Koşul sağlanmazsa aday stok elenir (zorunlu kural)",
              "- soft_boost: Koşul sağlanırsa puan eklenir/çıkarılır (tercih kuralı)",
              "",
              "### scopeType ve scopeValue",
              "- global: Tüm eşleştirmelerde geçerli (scopeValue: null)",
              "- customer: Belirli cari için geçerli (scopeValue: cari kodu veya adı)",
              "",
              "### isLocked",
              "- true: Chat'ten override edilemez (genelde hard kurallar için)",
              "- false: Chat'te geçici olarak devre dışı bırakılabilir",
              "",
              "### condition (JSON koşul)",
              "Desteklenen alanlar (field):",
              "- input.dim1: Girdi kalınlık/çap (mm)",
              "- input.dim2: Girdi en (mm)",
              "- input.dim3: Girdi boy (mm)",
              "- input.series: Girdi alaşım serisi (4 hane, ör: 5083)",
              "- input.temper: Girdi tamper (ör: H321, T6)",
              "- input.product_type: Girdi ürün tipi (PLAKA, BORU, SAC, vs.)",
              "- candidate.series: Aday stok alaşım serisi",
              "- candidate.temper: Aday stok tamper",
              "- candidate.stock_code: Aday stok kodu",
              "- candidate.stock_name: Aday stok adı",
              "- candidate.dim1: Aday kalınlık",
              "- candidate.dim2: Aday en",
              "- candidate.dim3: Aday boy",
              "- candidate.erp_cap: Aday ERP kalınlık",
              "",
              "Desteklenen operatörler (op):",
              "- eq veya =: Eşit",
              "- neq veya !=: Eşit değil",
              "- gt veya >: Büyük",
              "- gte veya >=: Büyük eşit",
              "- lt veya <: Küçük",
              "- lte veya <=: Küçük eşit",
              "- exists: Alan 0'dan farklı / boş değil (value gerekmez)",
              "- not_exists: Alan 0 veya boş (value gerekmez)",
              "- starts_with: Belirtilen değerle başlar",
              "- not_starts_with: Belirtilen değerle başlamaz",
              "- contains: İçerir",
              "- in: Listede var (value: dizi)",
              "- between: Aralıkta (value: [min, max])",
              "",
              "Bileşik koşullar:",
              "- {all: [...]} : Tüm koşullar sağlanmalı (AND)",
              "- {any: [...]} : Herhangi biri sağlanmalı (OR)",
              "- {not: {...}} : Ters koşul",
              "",
              "### effect (JSON etki)",
              "Hard filter efektleri:",
              "- require_prefix: Stok kodu belirtilen önek ile başlamalı (value: önek)",
              "- reject_prefix: Stok kodu belirtilen önek ile BAŞLAMAMALI (value: önek)",
              "- require_exact_series: Alaşım serisi tam eşleşmeli",
              "- reject_if_missing_dimension: Boyut bilgisi eksikse ele (dimension: thickness/width/length)",
              "- require_non_null: Belirtilen alan boş olmamalı (field: alan adı)",
              "",
              "Soft boost efektleri:",
              "- add_score: Puan ekle (value: sayı, pozitif=öne al, negatif=geri at)",
              "- multiply_score: Puanı çarp (value: çarpan)",
              "",
              "## Örnekler",
              "",
              "Kullanıcı: \"kalınlık 0-8 ise ALV ile başlamalı\"",
              "→ ruleType: hard_filter, isLocked: true",
              "  condition: {all: [{field:'input.dim1', op:'gte', value:0}, {field:'input.dim1', op:'lte', value:8}]}",
              "  effect: {type:'require_prefix', value:'ALV'}",
              "",
              "Kullanıcı: \"en boy ve kalınlık varsa stok kodu ACB ile başlayamaz\"",
              "→ ruleType: hard_filter, isLocked: true",
              "  condition: {all: [{field:'input.dim1', op:'exists'}, {field:'input.dim2', op:'exists'}, {field:'input.dim3', op:'exists'}]}",
              "  effect: {type:'reject_prefix', value:'ACB'}",
              "",
              "Kullanıcı: \"en boy kalınlık alanları 0 dan farklı ise stok kodu ACB ile başlayamaz\"",
              "→ ruleType: hard_filter, isLocked: true",
              "  condition: {all: [{field:'input.dim1', op:'exists'}, {field:'input.dim2', op:'exists'}, {field:'input.dim3', op:'exists'}]}",
              "  effect: {type:'reject_prefix', value:'ACB'}",
              "",
              "Kullanıcı: \"alaşım 7075 ise tam eşleşme zorunlu\"",
              "→ ruleType: hard_filter, isLocked: true",
              "  condition: {field:'input.series', op:'eq', value:'7075'}",
              "  effect: {type:'require_exact_series'}",
              "",
              "Kullanıcı: \"CARİ-001 için 5083 veya 5086 serisine +15 puan\"",
              "→ ruleType: soft_boost, scopeType: customer, scopeValue: 'CARİ-001', isLocked: false",
              "  condition: {any: [{field:'candidate.series', op:'eq', value:'5083'}, {field:'candidate.series', op:'eq', value:'5086'}]}",
              "  effect: {type:'add_score', value:15}",
              "",
              "Kullanıcı: \"H321 tamper olanları öne al\"",
              "→ ruleType: soft_boost, isLocked: false",
              "  condition: {field:'candidate.temper', op:'eq', value:'H321'}",
              "  effect: {type:'add_score', value:12}",
              "",
              "Kullanıcı: \"kalınlık 8'den büyükse APL ile başlamalı\"",
              "→ ruleType: hard_filter, isLocked: true",
              "  condition: {field:'input.dim1', op:'gt', value:8}",
              "  effect: {type:'require_prefix', value:'APL'}",
              "",
              "## Kurallar",
              "- description: Kuralın Türkçe açık açıklamasını yaz",
              "- Eleme/zorunluluk/yasaklama ifadeleri → hard_filter, isLocked: true",
              "- Tercih/öne al/puan ver ifadeleri → soft_boost, isLocked: false",
              "- Cari/müşteri belirtilmemişse → global, scopeValue: null",
              "- '0 dan farklı', 'boş değil', 'dolu', 'var' → op: 'exists'",
              "- '0 olan', 'boş', 'yok' → op: 'not_exists'",
              "- 'başlayamaz', 'başlamamalı', 'olamaz' → reject_prefix",
              "- 'başlamalı', 'ile başlasın' → require_prefix"
            ].join("\n")
          },
          {
            role: "user",
            content: message
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "rule_definition",
            strict: false,
            schema: {
              type: "object",
              properties: {
                ruleType: { type: "string", enum: ["hard_filter", "soft_boost"] },
                scopeType: { type: "string", enum: ["global", "customer"] },
                scopeValue: { type: ["string", "null"] },
                description: { type: "string" },
                isLocked: { type: "boolean" },
                condition: { type: "object" },
                effect: { type: "object" }
              },
              required: ["ruleType", "scopeType", "scopeValue", "description", "isLocked", "condition", "effect"]
            }
          }
        }
      })
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.error("[parseRuleDefinitionWithLlm] OpenAI API error:", response.status, errBody.substring(0, 300));
      return null;
    }

    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as LlmRulePlan;
    // condition ve effect string olarak gelebilir, parse et
    if (typeof parsed.condition === "string") {
      parsed.condition = JSON.parse(parsed.condition);
    }
    if (typeof parsed.effect === "string") {
      parsed.effect = JSON.parse(parsed.effect);
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function planInstructionMessage(args: {
  message: string;
  rowCount: number;
  sourceMode: string;
}): Promise<ParsedInstructionPlan> {
  const sanitizedMessage = String(args.message ?? "").trim();
  const { commands, ignored } = parseRowCommands(sanitizedMessage, args.rowCount);
  let matchPolicy = parseMatchPolicy(sanitizedMessage);
  const expectedItemCount = parseExpectedItemCount(sanitizedMessage);
  let rowDefaults = commands.find((command) => command.scope === "all")?.set ?? null;

  let extractionPrompt = expectedItemCount ? sanitizedMessage : null;

  // LLM her zaman çağrılır — new_rule intent'i regex ile yakalanamaz
  const llmResult = await parseInstructionWithLlm(sanitizedMessage, args.rowCount);
  let rulePreview: ParsedInstructionPlan["rulePreview"] = null;

  if (llmResult) {
    if (llmResult.intent === "new_rule" && llmResult.rule) {
      // Kural önizlemesi — UI onay alacak, henüz kaydetme
      rulePreview = {
        ruleType: llmResult.rule.ruleType,
        scopeType: llmResult.rule.scopeType,
        scopeValue: llmResult.rule.scopeValue,
        description: llmResult.rule.description,
        isLocked: llmResult.rule.isLocked,
        conditionJson: llmResult.rule.condition,
        effectJson: llmResult.rule.effect
      };
    } else {
      // Diğer intent'ler için regex sonucunu LLM ile birleştir
      if (llmResult.matchPolicy && !matchPolicy) {
        matchPolicy = llmResult.matchPolicy;
      }
      if (llmResult.extractionPrompt && !extractionPrompt) {
        extractionPrompt = llmResult.extractionPrompt;
      }
      if (llmResult.rowCommands && llmResult.rowCommands.length > 0 && commands.length === 0) {
        for (const cmd of llmResult.rowCommands) {
          const cleanSet: RowInstructionSet = {};
          if (cmd.set.kesimDurumu) cleanSet.kesimDurumu = cmd.set.kesimDurumu as "Kesim Var" | "Kesim Yok";
          if (cmd.set.mensei) cleanSet.mensei = cmd.set.mensei as "YERLİ" | "İTHAL";
          if (cmd.set.quantity != null) cleanSet.quantity = cmd.set.quantity;
          if (Object.keys(cleanSet).length > 0) {
            commands.push({
              scope: cmd.scope as "all" | "row",
              ...(cmd.scope === "row" ? { rowIndex: cmd.rowIndex ?? 0, rowNumber: cmd.rowNumber ?? 1 } : {}),
              set: cleanSet
            });
          }
        }
        rowDefaults = commands.find((c) => c.scope === "all")?.set ?? rowDefaults;
      }
    }
  }

  const needsRematch = Boolean(matchPolicy) || Boolean(extractionPrompt);
  const needsReextract = Boolean(extractionPrompt) && args.sourceMode !== "text";
  const learnable = Boolean(matchPolicy || expectedItemCount || (rowDefaults && (rowDefaults.kesimDurumu || rowDefaults.mensei)));

  return {
    rawMessage: sanitizedMessage,
    sanitizedMessage,
    rowCommands: commands,
    ignoredRowCommands: ignored,
    extractionPrompt,
    matchPolicy,
    rowDefaults,
    needsReextract,
    needsRematch,
    learnable,
    rulePreview
  };
}

export async function findBestInstructionPolicy(fingerprint: ExtractionFingerprint): Promise<StoredInstructionPolicy | null> {
  const res = await matchPool.query<StoredInstructionPolicy & {
    id: string;
    success_count: string;
    use_count: string;
    policy_json: string;
  }>(
    `SELECT
       id::text,
       name,
       policy_json::text,
       similarity(fingerprint_text, $1) AS similarity,
       success_count::text,
       use_count::text
     FROM instruction_policies
     WHERE active = TRUE
       AND success_count >= 2
       AND source_type = $2
       AND similarity(fingerprint_text, $1) >= 0.18
     ORDER BY (similarity(fingerprint_text, $1) + LEAST(success_count, 20) * 0.02 + LEAST(use_count, 40) * 0.01) DESC
     LIMIT 1`,
    [fingerprint.text, fingerprint.sourceType]
  );

  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  return {
    id: Number(row.id),
    name: row.name,
    policy_json: JSON.parse(row.policy_json) as InstructionPolicyPayload,
    similarity: Number(row.similarity),
    success_count: Number(row.success_count),
    use_count: Number(row.use_count)
  };
}

export async function commitInstructionPolicy(input: {
  fingerprint: ExtractionFingerprint;
  sourceName?: string | null;
  rawMessage: string;
  plan: ParsedInstructionPlan;
  approved: boolean;
}): Promise<{ policyId: number | null; activated: boolean }> {
  const policy: InstructionPolicyPayload = {
    extractionPrompt: input.plan.extractionPrompt,
    matchPolicy: input.plan.matchPolicy,
    rowDefaults: input.plan.rowDefaults
      ? {
        kesimDurumu: input.plan.rowDefaults.kesimDurumu,
        mensei: input.plan.rowDefaults.mensei
      }
      : null
  };

  if (!policy.extractionPrompt && !policy.matchPolicy && !policy.rowDefaults) {
    await matchPool.query(
      `INSERT INTO instruction_policy_events(source_type, fingerprint_text, fingerprint_json, raw_message, parsed_json, approved)
       VALUES($1,$2,$3::jsonb,$4,$5::jsonb,$6)`,
      [
        input.fingerprint.sourceType,
        input.fingerprint.text,
        JSON.stringify(input.fingerprint.json),
        input.rawMessage,
        JSON.stringify({
          rowCommands: input.plan.rowCommands,
          ignoredRowCommands: input.plan.ignoredRowCommands
        }),
        input.approved
      ]
    );
    return { policyId: null, activated: false };
  }

  const policyHash = hashPolicy(policy);
  const existingRes = await matchPool.query<{ id: string; active: boolean; success_count: string }>(
    `SELECT id::text, active, success_count::text
     FROM instruction_policies
     WHERE source_type = $1
       AND fingerprint_hash = $2
       AND policy_hash = $3
     LIMIT 1`,
    [input.fingerprint.sourceType, input.fingerprint.hash, policyHash]
  );

  let policyId: number;
  let activated = false;

  if ((existingRes.rowCount ?? 0) > 0) {
    policyId = Number(existingRes.rows[0].id);
    const nextSuccessCount = Number(existingRes.rows[0].success_count) + (input.approved ? 1 : 0);
    activated = !existingRes.rows[0].active && nextSuccessCount >= 2;
    await matchPool.query(
      `UPDATE instruction_policies
       SET updated_at = NOW(),
           use_count = use_count + 1,
           success_count = success_count + CASE WHEN $2 THEN 1 ELSE 0 END,
           failure_count = failure_count + CASE WHEN $2 THEN 0 ELSE 1 END,
           active = CASE WHEN success_count + CASE WHEN $2 THEN 1 ELSE 0 END >= 2 THEN TRUE ELSE active END
       WHERE id = $1`,
      [policyId, input.approved]
    );
  } else {
    const insertRes = await matchPool.query<{ id: string }>(
      `INSERT INTO instruction_policies(
         name, source_type, fingerprint_text, fingerprint_hash, fingerprint_json, policy_hash, policy_json, use_count, success_count, failure_count, active
       ) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,1,$8,$9,$10)
       RETURNING id`,
      [
        input.sourceName?.trim() || "chat-policy",
        input.fingerprint.sourceType,
        input.fingerprint.text,
        input.fingerprint.hash,
        JSON.stringify(input.fingerprint.json),
        policyHash,
        JSON.stringify(policy),
        input.approved ? 1 : 0,
        input.approved ? 0 : 1,
        input.approved ? false : false
      ]
    );
    policyId = Number(insertRes.rows[0].id);
  }

  await matchPool.query(
    `INSERT INTO instruction_policy_events(policy_id, source_type, fingerprint_text, fingerprint_json, raw_message, parsed_json, approved)
     VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7)`,
    [
      policyId,
      input.fingerprint.sourceType,
      input.fingerprint.text,
      JSON.stringify(input.fingerprint.json),
      input.rawMessage,
      JSON.stringify({
        rowCommands: input.plan.rowCommands,
        ignoredRowCommands: input.plan.ignoredRowCommands,
        policy
      }),
      input.approved
    ]
  );

  return { policyId, activated };
}



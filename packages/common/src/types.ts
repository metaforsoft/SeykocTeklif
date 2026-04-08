export type Nullable<T> = T | null;

export interface StockMasterRow {
  stock_id: number;
  stock_code: string | null;
  stock_name: string | null;
  stock_name2: string | null;
  description: string | null;
  category1: string | null;
  birim?: string | null;
  erp_en?: number | null;
  erp_boy?: number | null;
  erp_yukseklik?: number | null;
  erp_cap?: number | null;
  specific_gravity?: number | null;
  cinsi?: string | null;
  alasim?: string | null;
  tamper?: string | null;
  updated_at: Date | null;
  is_active?: boolean;
}

export interface ExtractedFeatures {
  product_type: string | null;
  series: string | null;
  series_group: string | null;
  temper: string | null;
  dim1: number | null;
  dim2: number | null;
  dim3: number | null;
  dim_text: string | null;
  search_text: string;
}

export interface MatchInput {
  text: string;
  topK?: number;
  matchInstruction?: string;
  matchPolicy?: MatchPolicy | null;
  filters?: {
    product_type?: string;
    series?: string;
  };
}

export interface MatchPolicy {
  stockCodePrefix?: string | null;
  requiredTerms?: string[];
  preferredSeries?: string | null;
  preferredTemper?: string | null;
  preferredProductType?: string | null;
}

export interface RowInstructionSet {
  kesimDurumu?: "Kesim Var" | "Kesim Yok";
  mensei?: "YERLİ" | "İTHAL";
  quantity?: number;
}

export interface RowInstructionCommand {
  scope: "all" | "row";
  rowIndex?: number;
  rowNumber?: number;
  set: RowInstructionSet;
}

export interface InstructionPolicyPayload {
  extractionPrompt?: string | null;
  matchPolicy?: MatchPolicy | null;
  rowDefaults?: RowInstructionSet | null;
}

export interface ParsedOrderLine {
  raw: string;
  query: string;
  normalized_line: string;
  dim_text: string | null;
  dim1: number | null;
  dim2: number | null;
  dim3: number | null;
  qty: number | null;
  series: string | null;
  header_context: string | null;
  confidence: number;
}

export interface ParsedOrderDocument {
  source_type: "plain_text" | "excel" | "docx" | "pdf_text" | "pdf_scanned" | "image";
  extracted_text: string;
  header_context: string | null;
  items: ParsedOrderLine[];
  parser_confidence: number;
  extraction_method?: string | null;
  learning?: {
    fingerprint_text?: string | null;
    fingerprint_hash?: string | null;
    fingerprint_json?: Record<string, unknown> | null;
    user_instruction?: string | null;
    effective_instruction?: string | null;
    applied_match_instruction?: string | null;
    applied_match_policy?: MatchPolicy | null;
    applied_profile_id?: number | null;
    applied_profile_name?: string | null;
    applied_instruction_policy_id?: number | null;
    applied_instruction_policy_name?: string | null;
    row_defaults?: RowInstructionSet | null;
  } | null;
  debug?: {
    requested_mode?: string | null;
    ai_forced?: boolean;
    fallback_attempted?: boolean;
    fallback_succeeded?: boolean;
    raw_text_preview?: string;
    item_count?: number;
    expected_item_count?: number | null;
    candidate_line_count?: number;
    vision_error?: string | null;
    llm_text_error?: string | null;
    llm_image_error?: string | null;
    ocr_error?: string | null;
  } | null;
}

export interface ExtractedFromInput {
  normalized_text: string;
  product_type: string | null;
  series: string | null;
  series_group: string | null;
  temper: string | null;
  dim1: number | null;
  dim2: number | null;
  dim3: number | null;
  dim_text: string | null;
}

export interface CandidateRow {
  stock_id: number;
  stock_code: string | null;
  stock_name: string | null;
  birim?: string | null;
  erp_cap?: number | null;
  erp_en?: number | null;
  erp_boy?: number | null;
  erp_yukseklik?: number | null;
  cinsi?: string | null;
  alasim?: string | null;
  tamper?: string | null;
  specific_gravity?: number | null;
  product_type: string | null;
  series: string | null;
  series_group: string | null;
  temper: string | null;
  dim_text: string | null;
  dim1: number | null;
  dim2: number | null;
  dim3: number | null;
  similarity: number;
}

export interface ScoredResult {
  stock_id: number;
  stock_code: string | null;
  stock_name: string | null;
  birim?: string | null;
  alasim?: string | null;
  tamper?: string | null;
  series?: string | null;
  temper?: string | null;
  score: number;
  why: string[];
}

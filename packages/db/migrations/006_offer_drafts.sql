CREATE TABLE IF NOT EXISTS offer_drafts (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'draft',
  customer_ref TEXT NULL,
  header_json JSONB NOT NULL,
  source_json JSONB NULL
);

CREATE TABLE IF NOT EXISTS offer_draft_lines (
  id BIGSERIAL PRIMARY KEY,
  draft_id BIGINT NOT NULL REFERENCES offer_drafts(id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  match_history_id BIGINT NULL REFERENCES match_history(id) ON DELETE SET NULL,
  selected_stock_id INT NULL,
  quantity NUMERIC NULL,
  line_json JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(draft_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_offer_drafts_status ON offer_drafts(status);
CREATE INDEX IF NOT EXISTS idx_offer_drafts_updated_at ON offer_drafts(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_offer_draft_lines_draft_id ON offer_draft_lines(draft_id);

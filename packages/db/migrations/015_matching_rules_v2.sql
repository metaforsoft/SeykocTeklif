CREATE TABLE IF NOT EXISTS canonical_stock_features (
  stock_id INT PRIMARY KEY REFERENCES stock_master(stock_id) ON DELETE CASCADE,
  stock_family TEXT NULL,
  product_type TEXT NULL,
  series TEXT NULL,
  series_group TEXT NULL,
  temper TEXT NULL,
  thickness NUMERIC NULL,
  width NUMERIC NULL,
  length NUMERIC NULL,
  height NUMERIC NULL,
  diameter NUMERIC NULL,
  unit TEXT NULL,
  raw_attributes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  search_text TEXT NULL,
  schema_version INT NOT NULL DEFAULT 1,
  normalized_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS matching_rule_sets (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  name TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'global',
  scope_value TEXT NULL,
  priority INT NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INT NOT NULL DEFAULT 1,
  created_by TEXT NULL
);

CREATE TABLE IF NOT EXISTS matching_rules (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  rule_set_id BIGINT NOT NULL REFERENCES matching_rule_sets(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL,
  target_level TEXT NOT NULL DEFAULT 'pair',
  condition_json JSONB NOT NULL,
  effect_json JSONB NOT NULL,
  stop_on_match BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT NULL
);

CREATE TABLE IF NOT EXISTS matching_rule_audit (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  match_history_id BIGINT NOT NULL REFERENCES match_history(id) ON DELETE CASCADE,
  rule_id BIGINT NOT NULL REFERENCES matching_rules(id) ON DELETE CASCADE,
  candidate_stock_id INT NULL,
  decision TEXT NOT NULL,
  delta_score NUMERIC NULL,
  reason_text TEXT NULL
);

CREATE TABLE IF NOT EXISTS match_candidate_features (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  match_history_id BIGINT NOT NULL REFERENCES match_history(id) ON DELETE CASCADE,
  stock_id INT NOT NULL,
  rank_before_ml INT NULL,
  was_selected BOOLEAN NOT NULL DEFAULT FALSE,
  feature_json JSONB NOT NULL,
  base_score NUMERIC NULL,
  final_score NUMERIC NULL
);

ALTER TABLE match_history
ADD COLUMN IF NOT EXISTS pipeline_version TEXT NULL;

ALTER TABLE match_history
ADD COLUMN IF NOT EXISTS rule_summary_json JSONB NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_stock_features_series ON canonical_stock_features(series);
CREATE INDEX IF NOT EXISTS idx_canonical_stock_features_product_type ON canonical_stock_features(product_type);
CREATE INDEX IF NOT EXISTS idx_matching_rule_sets_active ON matching_rule_sets(active);
CREATE INDEX IF NOT EXISTS idx_matching_rule_sets_scope ON matching_rule_sets(scope_type, scope_value);
CREATE INDEX IF NOT EXISTS idx_matching_rules_rule_set_id ON matching_rules(rule_set_id);
CREATE INDEX IF NOT EXISTS idx_matching_rules_active ON matching_rules(active);
CREATE INDEX IF NOT EXISTS idx_matching_rule_audit_match_history_id ON matching_rule_audit(match_history_id);
CREATE INDEX IF NOT EXISTS idx_match_candidate_features_match_history_id ON match_candidate_features(match_history_id);

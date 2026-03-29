CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS stock_master (
  stock_id INT PRIMARY KEY,
  stock_code TEXT,
  stock_name TEXT,
  stock_name2 TEXT,
  description TEXT,
  category1 TEXT,
  updated_at TIMESTAMP NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS stock_features (
  stock_id INT PRIMARY KEY REFERENCES stock_master(stock_id) ON DELETE CASCADE,
  category3 TEXT,
  product_type TEXT,
  series TEXT,
  series_group TEXT,
  temper TEXT,
  dim1 NUMERIC,
  dim2 NUMERIC,
  dim3 NUMERIC,
  dim_text TEXT,
  search_text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS match_history (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  input_text TEXT NOT NULL,
  extracted_json JSONB NOT NULL,
  results_json JSONB NOT NULL,
  selected_stock_id INT NULL,
  user_note TEXT NULL
);

CREATE TABLE IF NOT EXISTS sync_checkpoint (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_features_search_text_trgm ON stock_features USING GIN (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_stock_features_series ON stock_features(series);
CREATE INDEX IF NOT EXISTS idx_stock_features_temper ON stock_features(temper);
CREATE INDEX IF NOT EXISTS idx_stock_features_product_type ON stock_features(product_type);
CREATE INDEX IF NOT EXISTS idx_stock_features_category3 ON stock_features(category3);

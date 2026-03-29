ALTER TABLE stock_master ADD COLUMN IF NOT EXISTS category1 TEXT;
ALTER TABLE stock_features ADD COLUMN IF NOT EXISTS category3 TEXT;
CREATE INDEX IF NOT EXISTS idx_stock_features_category3 ON stock_features(category3);

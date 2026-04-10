CREATE TABLE IF NOT EXISTS app_users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_sessions (
  id BIGSERIAL PRIMARY KEY,
  session_token TEXT NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_sessions_user_id ON app_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_app_sessions_expires_at ON app_sessions(expires_at);

CREATE TABLE IF NOT EXISTS matched_offers (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  source_name TEXT NULL,
  source_type TEXT NULL,
  extraction_method TEXT NULL,
  profile_name TEXT NULL,
  created_by_user_id BIGINT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  line_count INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'saved',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matched_offers_created_by ON matched_offers(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_matched_offers_created_at ON matched_offers(created_at DESC);

CREATE TABLE IF NOT EXISTS matched_offer_lines (
  id BIGSERIAL PRIMARY KEY,
  matched_offer_id BIGINT NOT NULL REFERENCES matched_offers(id) ON DELETE CASCADE,
  line_no INT NOT NULL,
  match_history_id BIGINT NULL REFERENCES match_history(id) ON DELETE SET NULL,
  selected_stock_id INT NULL,
  stock_code TEXT NULL,
  stock_name TEXT NULL,
  birim TEXT NULL,
  quantity NUMERIC NULL,
  dim_kalinlik NUMERIC NULL,
  dim_en NUMERIC NULL,
  dim_boy NUMERIC NULL,
  kesim_durumu TEXT NULL,
  selected_score NUMERIC NULL,
  is_manual BOOLEAN NOT NULL DEFAULT FALSE,
  source_line_text TEXT NULL,
  line_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matched_offer_lines_offer_id ON matched_offer_lines(matched_offer_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_users WHERE username = 'admin') THEN
    INSERT INTO app_users(username, password_hash, full_name, role, is_active)
    VALUES (
      'admin',
      'scrypt$16384$8$1$b4234840a30bd313f0dd9884e2fa484f$e35efb35ae4bd30d132fba7e9b312f80935bfd1a71d555fd86041ca633f2638415f7424bb8f24a7c913729c771d0f90962b96f16b2dd90e046ff0a1959a9e673',
      'Sistem Yonetici',
      'admin',
      TRUE
    );
  END IF;
END $$;

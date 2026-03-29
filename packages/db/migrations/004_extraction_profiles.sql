CREATE TABLE IF NOT EXISTS extraction_profiles (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  fingerprint_text TEXT NOT NULL,
  fingerprint_json JSONB NOT NULL,
  instruction_text TEXT NOT NULL,
  profile_json JSONB NULL,
  use_count INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS extraction_profile_examples (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  profile_id BIGINT NOT NULL REFERENCES extraction_profiles(id) ON DELETE CASCADE,
  sample_name TEXT NULL,
  fingerprint_json JSONB NOT NULL,
  instruction_text TEXT NOT NULL,
  extracted_json JSONB NOT NULL,
  confirmed_json JSONB NULL
);

CREATE TABLE IF NOT EXISTS extraction_feedback (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  profile_id BIGINT NULL REFERENCES extraction_profiles(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL,
  fingerprint_text TEXT NOT NULL,
  fingerprint_json JSONB NOT NULL,
  user_instruction TEXT NULL,
  effective_instruction TEXT NULL,
  extracted_json JSONB NOT NULL,
  confirmed_json JSONB NULL,
  approved BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_extraction_profiles_source_type ON extraction_profiles(source_type);
CREATE INDEX IF NOT EXISTS idx_extraction_profiles_active ON extraction_profiles(active);
CREATE INDEX IF NOT EXISTS idx_extraction_profiles_fingerprint_trgm ON extraction_profiles USING GIN (fingerprint_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_extraction_feedback_profile_id ON extraction_feedback(profile_id);

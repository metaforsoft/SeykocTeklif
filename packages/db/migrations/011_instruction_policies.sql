CREATE TABLE IF NOT EXISTS instruction_policies (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  fingerprint_text TEXT NOT NULL,
  fingerprint_hash TEXT NOT NULL,
  fingerprint_json JSONB NOT NULL,
  policy_hash TEXT NOT NULL,
  policy_json JSONB NOT NULL,
  use_count INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  failure_count INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS instruction_policy_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  policy_id BIGINT NULL REFERENCES instruction_policies(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL,
  fingerprint_text TEXT NOT NULL,
  fingerprint_json JSONB NOT NULL,
  raw_message TEXT NOT NULL,
  parsed_json JSONB NOT NULL,
  approved BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_instruction_policies_unique
  ON instruction_policies(source_type, fingerprint_hash, policy_hash);
CREATE INDEX IF NOT EXISTS idx_instruction_policies_source_type
  ON instruction_policies(source_type);
CREATE INDEX IF NOT EXISTS idx_instruction_policies_active
  ON instruction_policies(active);
CREATE INDEX IF NOT EXISTS idx_instruction_policies_fingerprint_trgm
  ON instruction_policies USING GIN (fingerprint_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_instruction_policy_events_policy_id
  ON instruction_policy_events(policy_id);

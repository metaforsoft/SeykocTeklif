ALTER TABLE outbound_order_queue
  ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP NULL;

ALTER TABLE outbound_order_queue
  ALTER COLUMN next_retry_at SET DEFAULT NOW();

UPDATE outbound_order_queue
SET next_retry_at = NOW()
WHERE next_retry_at IS NULL
  AND status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_outbound_order_queue_status_retry
  ON outbound_order_queue(status, next_retry_at);

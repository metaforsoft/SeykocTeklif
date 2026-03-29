CREATE TABLE IF NOT EXISTS outbound_order_queue (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  match_history_id BIGINT NOT NULL REFERENCES match_history(id) ON DELETE CASCADE,
  selected_stock_id INT NOT NULL,
  quantity NUMERIC NULL,
  customer_ref TEXT NULL,
  source_text TEXT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  response_json JSONB NULL,
  error_text TEXT NULL,
  sent_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_outbound_order_queue_status ON outbound_order_queue(status);
CREATE INDEX IF NOT EXISTS idx_outbound_order_queue_match_history_id ON outbound_order_queue(match_history_id);

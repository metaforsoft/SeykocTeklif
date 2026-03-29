import { env, matchPool } from "@smp/db";

interface ClaimedQueueItem {
  id: number;
  payload_json: Record<string, unknown>;
  attempt_count: number;
}

const RETRY_BASE_SECONDS = 20;
const RETRY_MAX_SECONDS = 30 * 60;
const ENDPOINT_MISSING_RETRY_SECONDS = 300;

function retryDelaySeconds(attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1);
  return Math.min(RETRY_MAX_SECONDS, RETRY_BASE_SECONDS * Math.pow(2, exponent));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function payloadTypeOf(payload: Record<string, unknown>): "erp_order" | "erp_offer" {
  return payload["payloadType"] === "erp_offer" ? "erp_offer" : "erp_order";
}

function resolveErpTarget(payload: Record<string, unknown>): { endpoint: string; apiKey: string } {
  const payloadType = payloadTypeOf(payload);

  if (payloadType === "erp_offer") {
    return {
      endpoint: (env.erpOffer.endpoint || env.erpOrder.endpoint).trim(),
      apiKey: env.erpOffer.apiKey || env.erpOrder.apiKey
    };
  }

  return {
    endpoint: env.erpOrder.endpoint.trim(),
    apiKey: env.erpOrder.apiKey
  };
}

async function claimQueueBatch(maxAttempts: number, batchSize: number): Promise<ClaimedQueueItem[]> {
  const client = await matchPool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<{
      id: string;
      payload_json: Record<string, unknown>;
      attempt_count: string;
    }>(
      `WITH picked AS (
         SELECT id
         FROM outbound_order_queue
         WHERE status IN ('pending', 'failed')
           AND COALESCE(next_retry_at, NOW()) <= NOW()
           AND COALESCE(attempt_count, 0) < $1
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE outbound_order_queue q
       SET status = 'sending',
           last_attempt_at = NOW(),
           attempt_count = COALESCE(q.attempt_count, 0) + 1
       FROM picked
       WHERE q.id = picked.id
       RETURNING q.id::text, q.payload_json, q.attempt_count::text`,
      [maxAttempts, batchSize]
    );
    await client.query("COMMIT");

    return res.rows.map((row) => ({
      id: Number(row.id),
      payload_json: row.payload_json,
      attempt_count: Number(row.attempt_count)
    }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function markSent(queueId: number, responseJson: Record<string, unknown>): Promise<void> {
  await matchPool.query(
    `UPDATE outbound_order_queue
     SET status = 'sent',
         response_json = $1::jsonb,
         error_text = NULL,
         sent_at = NOW(),
         next_retry_at = NULL
     WHERE id = $2`,
    [JSON.stringify(responseJson), queueId]
  );
}

async function markFailed(queueId: number, attemptCount: number, maxAttempts: number, errorText: string, responseJson?: Record<string, unknown>): Promise<void> {
  const shouldRetry = attemptCount < maxAttempts;
  const retrySeconds = shouldRetry ? retryDelaySeconds(attemptCount) : null;

  await matchPool.query(
    `UPDATE outbound_order_queue
     SET status = 'failed',
         error_text = $1,
         response_json = COALESCE($2::jsonb, response_json),
         next_retry_at = CASE
           WHEN $3::boolean THEN NOW() + ($4::text || ' seconds')::interval
           ELSE NULL
         END
     WHERE id = $5`,
    [errorText.slice(0, 1000), responseJson ? JSON.stringify(responseJson) : null, shouldRetry, retrySeconds ?? 0, queueId]
  );
}

async function markPendingNoEndpoint(queueId: number): Promise<void> {
  await matchPool.query(
    `UPDATE outbound_order_queue
     SET status = 'pending',
         error_text = 'ERP endpoint not configured for payload type',
         next_retry_at = NOW() + ($1::text || ' seconds')::interval,
         attempt_count = GREATEST(0, COALESCE(attempt_count, 0) - 1)
     WHERE id = $2`,
    [ENDPOINT_MISSING_RETRY_SECONDS, queueId]
  );
}

async function dispatchItem(item: ClaimedQueueItem): Promise<void> {
  const target = resolveErpTarget(item.payload_json);
  if (!target.endpoint) {
    await markPendingNoEndpoint(item.id);
    return;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (target.apiKey) {
    headers.Authorization = `Bearer ${target.apiKey}`;
  }

  try {
    const response = await fetch(target.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(item.payload_json)
    });

    const body = await response.text();
    const responseJson = {
      status: response.status,
      ok: response.ok,
      body
    };

    if (response.ok) {
      await markSent(item.id, responseJson);
      return;
    }

    await markFailed(
      item.id,
      item.attempt_count,
      env.orderDispatch.maxAttempts,
      `ERP HTTP ${response.status}`,
      responseJson
    );
  } catch (error) {
    await markFailed(
      item.id,
      item.attempt_count,
      env.orderDispatch.maxAttempts,
      toErrorMessage(error)
    );
  }
}

async function dispatchOnce(): Promise<void> {
  const hasAtLeastOneTarget = Boolean(env.erpOrder.endpoint.trim() || env.erpOffer.endpoint.trim());
  if (!hasAtLeastOneTarget) {
    return;
  }

  const batch = await claimQueueBatch(env.orderDispatch.maxAttempts, env.orderDispatch.batchSize);
  if (batch.length === 0) {
    return;
  }

  for (const item of batch) {
    await dispatchItem(item);
  }

  console.log(JSON.stringify({
    event: "order_dispatch_cycle",
    picked: batch.length
  }));
}

async function start(): Promise<void> {
  await dispatchOnce().catch((error) => {
    console.error("order-dispatcher initial cycle failed", error);
  });

  const intervalMs = Math.max(5, env.orderDispatch.intervalSeconds) * 1000;
  setInterval(() => {
    dispatchOnce().catch((error) => {
      console.error("order-dispatcher cycle failed", error);
    });
  }, intervalMs);
}

start().catch((error) => {
  console.error("order-dispatcher fatal", error);
  process.exit(1);
});

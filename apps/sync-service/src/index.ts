import { env, erpPool, matchPool } from "@smp/db";
import { extractFeaturesFromStock, StockMasterRow } from "@smp/common";

const CHECKPOINT_KEY = "erp_stock_last_updated_at";

interface ErpRawRow {
  stock_id: number;
  stock_code: string | null;
  stock_name: string | null;
  stock_name2: string | null;
  description: string | null;
  category1: string | null;
  birim: string | null;
  erp_en: number | null;
  erp_boy: number | null;
  erp_yukseklik: number | null;
  erp_cap: number | null;
  updated_at: Date | null;
}

function selectClause(): string {
  const c = env.erp.columns;
  const q = (v: string) => `"${v.replace(/"/g, "\"\"")}"`;
  const colOrNull = (name: string, alias: string) =>
    name && name.trim().length > 0 ? `${q(name)} AS ${alias}` : `NULL::text AS ${alias}`;
  const numOrNull = (name: string, alias: string) =>
    name && name.trim().length > 0 ? `${q(name)} AS ${alias}` : `NULL::numeric AS ${alias}`;
  const parts = [
    `${q(c.stockId)} AS stock_id`,
    colOrNull(c.stockCode, "stock_code"),
    colOrNull(c.stockName, "stock_name"),
    colOrNull(c.stockName2, "stock_name2"),
    colOrNull(c.description, "description"),
    colOrNull(c.category1, "category1"),
    colOrNull(c.birim, "birim"),
    numOrNull(c.en, "erp_en"),
    numOrNull(c.boy, "erp_boy"),
    numOrNull(c.yukseklik, "erp_yukseklik"),
    numOrNull(c.cap, "erp_cap")
  ];

  if (c.updatedAt && c.updatedAt.trim().length > 0) {
    parts.push(`${q(c.updatedAt)} AS updated_at`);
  } else {
    parts.push(`NULL::timestamp AS updated_at`);
  }

  return parts.join(", ");
}

function quoteQualifiedName(name: string): string {
  return name
    .split(".")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `"${p.replace(/"/g, "\"\"")}"`)
    .join(".");
}

async function getCheckpoint(): Promise<string | null> {
  const res = await matchPool.query<{ value: string }>("SELECT value FROM sync_checkpoint WHERE key=$1", [CHECKPOINT_KEY]);
  return res.rows[0]?.value ?? null;
}

async function setCheckpoint(value: string): Promise<void> {
  await matchPool.query(
    `INSERT INTO sync_checkpoint(key, value) VALUES($1, $2)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [CHECKPOINT_KEY, value]
  );
}

async function fetchErpRows(lastUpdatedAt: string | null): Promise<ErpRawRow[]> {
  const hasUpdated = env.erp.columns.updatedAt && env.erp.columns.updatedAt.trim().length > 0;
  const baseSql = `SELECT ${selectClause()} FROM ${quoteQualifiedName(env.erp.stockView)}`;

  if (hasUpdated && lastUpdatedAt) {
    const updatedAtCol = `"${env.erp.columns.updatedAt.replace(/"/g, "\"\"")}"`;
    const sql = `${baseSql} WHERE ${updatedAtCol} > $1 ORDER BY ${updatedAtCol} ASC`;
    const res = await erpPool.query<ErpRawRow>(sql, [lastUpdatedAt]);
    return res.rows;
  }

  const res = await erpPool.query<ErpRawRow>(baseSql);
  return res.rows;
}

async function upsertStockMaster(rows: StockMasterRow[]): Promise<void> {
  if (rows.length === 0) return;
  const client = await matchPool.connect();
  try {
    await client.query("BEGIN");
    for (const r of rows) {
      await client.query(
        `INSERT INTO stock_master(stock_id, stock_code, stock_name, stock_name2, description, category1, birim, erp_en, erp_boy, erp_yukseklik, erp_cap, updated_at, is_active)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE)
         ON CONFLICT(stock_id) DO UPDATE SET
           stock_code=EXCLUDED.stock_code,
           stock_name=EXCLUDED.stock_name,
           stock_name2=EXCLUDED.stock_name2,
           description=EXCLUDED.description,
           category1=EXCLUDED.category1,
           birim=EXCLUDED.birim,
           erp_en=EXCLUDED.erp_en,
           erp_boy=EXCLUDED.erp_boy,
           erp_yukseklik=EXCLUDED.erp_yukseklik,
           erp_cap=EXCLUDED.erp_cap,
           updated_at=EXCLUDED.updated_at,
            is_active=TRUE`,
        [
          r.stock_id,
          r.stock_code,
          r.stock_name,
          r.stock_name2,
          r.description,
          r.category1,
          r.birim ?? null,
          r.erp_en ?? null,
          r.erp_boy ?? null,
          r.erp_yukseklik ?? null,
          r.erp_cap ?? null,
          r.updated_at
        ]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function markInactiveMissing(currentIds: number[]): Promise<void> {
  if (currentIds.length === 0) return;
  await matchPool.query(
    `UPDATE stock_master
     SET is_active=FALSE
     WHERE stock_id NOT IN (SELECT unnest($1::int[]))`,
    [currentIds]
  );
}

async function upsertFeatures(rows: StockMasterRow[]): Promise<void> {
  if (rows.length === 0) return;
  const client = await matchPool.connect();
  try {
    await client.query("BEGIN");
    for (const r of rows) {
      const f = extractFeaturesFromStock(r);
      await client.query(
        `INSERT INTO stock_features(stock_id, product_type, series, series_group, temper, dim1, dim2, dim3, dim_text, search_text)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT(stock_id) DO UPDATE SET
           product_type=EXCLUDED.product_type,
           series=EXCLUDED.series,
           series_group=EXCLUDED.series_group,
           temper=EXCLUDED.temper,
           dim1=EXCLUDED.dim1,
           dim2=EXCLUDED.dim2,
           dim3=EXCLUDED.dim3,
           dim_text=EXCLUDED.dim_text,
           search_text=EXCLUDED.search_text`,
        [r.stock_id, f.product_type, f.series, f.series_group, f.temper, f.dim1, f.dim2, f.dim3, f.dim_text, f.search_text]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function runSync(): Promise<void> {
  const started = Date.now();
  const hasIncremental = env.erp.columns.updatedAt && env.erp.columns.updatedAt.trim().length > 0;
  const checkpoint = hasIncremental ? await getCheckpoint() : null;
  const erpRows = await fetchErpRows(checkpoint);

  const mapped: StockMasterRow[] = erpRows.map((r) => ({
    stock_id: Number(r.stock_id),
    stock_code: r.stock_code,
    stock_name: r.stock_name,
    stock_name2: r.stock_name2,
    description: r.description,
    category1: r.category1,
    birim: r.birim,
    erp_en: r.erp_en,
    erp_boy: r.erp_boy,
    erp_yukseklik: r.erp_yukseklik,
    erp_cap: r.erp_cap,
    updated_at: r.updated_at ? new Date(r.updated_at) : null,
    is_active: true
  }));

  await upsertStockMaster(mapped);
  await upsertFeatures(mapped);

  if (!hasIncremental) {
    await markInactiveMissing(mapped.map((m) => m.stock_id));
  }

  if (hasIncremental && mapped.length > 0) {
    const last = mapped
      .map((m) => m.updated_at)
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => a.getTime() - b.getTime())
      .at(-1);
    if (last) {
      await setCheckpoint(last.toISOString());
    }
  }

  const durationMs = Date.now() - started;
  console.log(
    JSON.stringify({
      event: "sync_completed",
      incremental: Boolean(hasIncremental),
      fetched: mapped.length,
      duration_ms: durationMs,
      checkpoint_before: checkpoint
    })
  );
}

async function start(): Promise<void> {
  await runSync().catch((e) => console.error("Initial sync failed", e));

  setInterval(() => {
    runSync().catch((e) => console.error("Scheduled sync failed", e));
  }, Math.max(5, env.syncIntervalSeconds) * 1000);
}

start().catch((e) => {
  console.error("sync-service fatal", e);
  process.exit(1);
});

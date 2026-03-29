import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { matchPool } from "./pools";

const MIGRATION_LOCK_KEY = 914207331;

async function ensureSchemaMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(client: PoolClient): Promise<Set<string>> {
  const res = await client.query<{ filename: string }>("SELECT filename FROM schema_migrations");
  return new Set(res.rows.map((r) => r.filename));
}

export async function runMigrations(): Promise<void> {
  const client = await matchPool.connect();
  let lockHeld = false;

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    lockHeld = true;

    await ensureSchemaMigrationsTable(client);
    const migrationsDir = path.resolve(__dirname, "..", "migrations");
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    const applied = await getAppliedMigrations(client);

    for (const filename of files) {
      if (applied.has(filename)) continue;
      const sqlRaw = await readFile(path.join(migrationsDir, filename), "utf8");
      const sql = sqlRaw.replace(/^\uFEFF/, "");

      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(filename) VALUES($1)", [filename]);
        await client.query("COMMIT");
        console.log(`[migration] applied ${filename}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    if (lockHeld) {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
    client.release();
  }
}

runMigrations()
  .then(async () => {
    await matchPool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Migration failed", err);
    await matchPool.end();
    process.exit(1);
  });

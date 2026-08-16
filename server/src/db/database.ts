import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is required. Start PostgreSQL (docker compose up -d db) and configure server/.env.",
  );
}

export const database = new Pool({
  connectionString,
  max: Number(process.env.DATABASE_POOL_SIZE ?? 12),
  ssl:
    process.env.PGSSLMODE === "require"
      ? { rejectUnauthorized: false }
      : undefined,
});

/** Applies each numbered SQL migration exactly once, before the game accepts clients. */
export async function runMigrations(): Promise<void> {
  const migrationsDir = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../migrations",
  );
  const migrations = readdirSync(migrationsDir)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  const client = await database.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const id of migrations) {
      const applied = await client.query<{ id: string }>(
        "SELECT id FROM schema_migrations WHERE id = $1",
        [id],
      );
      if (applied.rowCount) continue;

      await client.query("BEGIN");
      try {
        await client.query(readFileSync(join(migrationsDir, id), "utf8"));
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [
          id,
        ]);
        await client.query("COMMIT");
        console.log(`[database] applied migration ${id}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
  }
}

export async function closeDatabase(): Promise<void> {
  await database.end();
}

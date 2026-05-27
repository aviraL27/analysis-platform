import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Pool, PoolClient } from "pg";

const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations"
);

interface MigrationFile {
  name: string;
  sql: string;
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query("ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY");
}

async function listMigrationFiles(): Promise<MigrationFile[]> {
  const names = await readdir(migrationsDirectory);
  const migrationNames = names
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    migrationNames.map(async (name) => ({
      name,
      sql: await readFile(path.join(migrationsDirectory, name), "utf8")
    }))
  );
}

async function hasMigrationRun(client: PoolClient, name: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1)",
    [name]
  );

  return result.rows[0]?.exists ?? false;
}

async function applyMigration(client: PoolClient, migration: MigrationFile): Promise<void> {
  await client.query("BEGIN");

  try {
    await client.query(migration.sql);
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [migration.name]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function runMigrations(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await ensureMigrationsTable(client);

    for (const migration of await listMigrationFiles()) {
      if (await hasMigrationRun(client, migration.name)) {
        continue;
      }

      await applyMigration(client, migration);
      applied.push(migration.name);
    }
  } finally {
    client.release();
  }

  return applied;
}

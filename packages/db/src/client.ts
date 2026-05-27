import { Pool, type PoolConfig } from "pg";

export interface DatabaseConfig {
  connectionString: string;
  max?: number;
  ssl?: PoolConfig["ssl"];
}

export function getDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const connectionString = env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  return {
    connectionString,
    max: Number.parseInt(env.DATABASE_POOL_MAX ?? "10", 10),
    ssl: env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
  };
}

export function createDatabasePool(config: DatabaseConfig = getDatabaseConfig()): Pool {
  return new Pool(config);
}

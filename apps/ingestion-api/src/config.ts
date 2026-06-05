import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

export interface IngestionConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  queueName: string;
  tenantCacheTtlSeconds: number;
  rateLimitMaxRequests: number;
  rateLimitWindowSeconds: number;
}

function readRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function readNumberEnv(name: string, fallback: number): number {
  const rawValue = process.env[name];

  if (!rawValue) {
    return fallback;
  }

  const value = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

export function getConfig(): IngestionConfig {
  return {
    port: readNumberEnv("INGESTION_API_PORT", 3001),
    databaseUrl: readRequiredEnv("DATABASE_URL"),
    redisUrl: readRequiredEnv("REDIS_URL"),
    queueName: process.env.EVENTS_QUEUE_NAME ?? "events",
    tenantCacheTtlSeconds: readNumberEnv("TENANT_CACHE_TTL_SECONDS", 300),
    rateLimitMaxRequests: readNumberEnv("INGEST_RATE_LIMIT_MAX", 1000),
    rateLimitWindowSeconds: readNumberEnv("INGEST_RATE_LIMIT_WINDOW_SECONDS", 60)
  };
}

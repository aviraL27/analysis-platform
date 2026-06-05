import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

export interface WorkerConfig {
  databaseUrl: string;
  redisUrl: string;
  queueName: string;
  batchSize: number;
  batchFlushIntervalMs: number;
  workerConcurrency: number;
  realtimeServerUrl?: string;
  realtimeWorkerToken?: string;
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

export function getConfig(): WorkerConfig {
  const config: WorkerConfig = {
    databaseUrl: readRequiredEnv("DATABASE_URL"),
    redisUrl: readRequiredEnv("REDIS_URL"),
    queueName: process.env.EVENTS_QUEUE_NAME ?? "events",
    batchSize: readNumberEnv("WORKER_BATCH_SIZE", 50),
    batchFlushIntervalMs: readNumberEnv("WORKER_BATCH_FLUSH_INTERVAL_MS", 1000),
    workerConcurrency: readNumberEnv("WORKER_CONCURRENCY", 10)
  };

  if (process.env.DASHBOARD_REALTIME_URL) {
    config.realtimeServerUrl = process.env.DASHBOARD_REALTIME_URL;
  }

  if (process.env.DASHBOARD_WORKER_TOKEN) {
    config.realtimeWorkerToken = process.env.DASHBOARD_WORKER_TOKEN;
  }

  return config;
}

import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

export interface DashboardConfig {
  port: number;
  frontendOrigins: string[];
  supabaseUrl?: string;
  supabaseJwtSecret: string;
  workerRealtimeToken?: string;
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

function readOriginsEnv(name: string, fallback: string[]): string[] {
  const origins = process.env[name]
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins?.length ? origins : fallback;
}

export function getConfig(): DashboardConfig {
  const config: DashboardConfig = {
    port: readNumberEnv("DASHBOARD_API_PORT", 3002),
    frontendOrigins: readOriginsEnv("FRONTEND_ORIGIN", [
      "http://localhost:5173",
      "http://127.0.0.1:5173"
    ]),
    supabaseJwtSecret: readRequiredEnv("SUPABASE_JWT_SECRET")
  };

  if (process.env.SUPABASE_URL) {
    config.supabaseUrl = process.env.SUPABASE_URL;
  }

  if (process.env.DASHBOARD_WORKER_TOKEN) {
    config.workerRealtimeToken = process.env.DASHBOARD_WORKER_TOKEN;
  }

  return config;
}

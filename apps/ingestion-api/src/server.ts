import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import type { Pool } from "pg";
import type IORedis from "ioredis";
import type { EventQueueJob } from "@analytiq/types";
import type { IngestionConfig } from "./config.js";
import type { EventsQueue } from "./queue.js";
import { isDomainAllowed } from "./domain.js";
import { checkRateLimit } from "./rate-limit.js";
import { ingestSchema } from "./schemas.js";
import { getTenantByToken } from "./tenants.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ServerDependencies {
  config: IngestionConfig;
  redis: IORedis;
  pool: Pool;
  queue: EventsQueue;
}

function getClientIp(request: Request): string | undefined {
  const forwardedFor = request.header("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim();
  }

  return request.ip;
}

export function createServer({ config, redis, pool, queue }: ServerDependencies): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.get("/sdk", cors({ origin: "*" }), (_request, response) => {
    const sdkPath = path.resolve(__dirname, "../../../sdk/dist/index.global.js");
    response.setHeader("Content-Type", "application/javascript");
    response.sendFile(sdkPath);
  });

  app.options("/ingest", cors({ origin: "*" }));
  app.post("/ingest", cors({ origin: "*" }), async (request, response, next) => {
    try {
      const payload = ingestSchema.parse(request.body);
      const tenant = await getTenantByToken(redis, pool, payload.token, config.tenantCacheTtlSeconds);

      if (!tenant) {
        response.status(401).json({ error: "Invalid token" });
        return;
      }

      if (!isDomainAllowed(payload.url, tenant.domainWhitelist)) {
        response.status(403).json({ error: "Domain is not allowed" });
        return;
      }

      const rateLimit = await checkRateLimit(
        redis,
        payload.token,
        config.rateLimitMaxRequests,
        config.rateLimitWindowSeconds
      );

      response.setHeader("X-RateLimit-Limit", config.rateLimitMaxRequests.toString());
      response.setHeader("X-RateLimit-Remaining", rateLimit.remaining.toString());
      response.setHeader("X-RateLimit-Reset", rateLimit.resetAt.toISOString());

      if (!rateLimit.allowed) {
        response.status(429).json({ error: "Rate limit exceeded" });
        return;
      }

      const job: EventQueueJob = {
        tenantId: tenant.id,
        eventName: payload.eventName,
        properties: payload.properties,
        sessionId: payload.sessionId,
        url: payload.url,
        occurredAt: payload.occurredAt,
      };
      const userAgent = payload.userAgent ?? request.header("user-agent");
      const ipAddress = getClientIp(request);

      if (payload.referrer) {
        job.referrer = payload.referrer;
      }

      if (userAgent) {
        job.userAgent = userAgent;
      }

      if (ipAddress) {
        job.ipAddress = ipAddress;
      }

      await queue.add("event", job);

      response.status(200).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) {
      return;
    }

    if (error instanceof Error && error.name === "ZodError") {
      response.status(400).json({ error: "Malformed ingest payload" });
      return;
    }

    response.status(500).json({ error: "Internal server error" });
  });

  return app;
}

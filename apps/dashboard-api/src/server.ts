import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import type { Pool } from "pg";
import { ZodError } from "zod";
import { createAuthMiddleware, requireAuth } from "./auth.js";
import type { DashboardConfig } from "./config.js";
import {
  getEventLog,
  getOverviewStats,
  getRealtimeStats,
  getTenantForUser,
  getTimeseries,
  setupTenant,
  updateTenantDomains
} from "./db.js";
import {
  eventsQuerySchema,
  overviewQuerySchema,
  tenantDomainsSchema,
  tenantSetupSchema,
  timeseriesQuerySchema
} from "./schemas.js";

interface ServerDependencies {
  config: DashboardConfig;
  pool: Pool;
}

async function requireTenant(pool: Pool, userId: string) {
  const tenant = await getTenantForUser(pool, userId);

  if (!tenant) {
    const error = new Error("Tenant has not been set up");
    error.name = "TenantNotFoundError";
    throw error;
  }

  return tenant;
}

export function createServer({ config, pool }: ServerDependencies): express.Express {
  const app = express();
  const requireJwt = createAuthMiddleware(config);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: config.frontendOrigin, credentials: true }));
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.use(requireJwt);

  app.get("/tenant", async (request, response, next) => {
    try {
      const auth = requireAuth(request);
      const tenant = await requireTenant(pool, auth.userId);

      response.status(200).json({ tenant });
    } catch (error) {
      next(error);
    }
  });

  app.post("/tenants/setup", async (request, response, next) => {
    try {
      const auth = requireAuth(request);
      const body = tenantSetupSchema.parse(request.body);
      const tenant = await setupTenant(pool, auth.userId, body.name);

      response.status(200).json({ tenant });
    } catch (error) {
      next(error);
    }
  });

  app.put("/tenants/domains", async (request, response, next) => {
    try {
      const auth = requireAuth(request);
      const body = tenantDomainsSchema.parse(request.body);
      const tenant = await requireTenant(pool, auth.userId);
      const updatedTenant = await updateTenantDomains(pool, tenant.id, body.domains);

      response.status(200).json({ tenant: updatedTenant });
    } catch (error) {
      next(error);
    }
  });

  app.get("/stats/overview", async (request, response, next) => {
    try {
      const auth = requireAuth(request);
      const query = overviewQuerySchema.parse(request.query);
      const tenant = await requireTenant(pool, auth.userId);
      const stats = await getOverviewStats(pool, tenant.id, query.range);

      response.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  });

  app.get("/stats/timeseries", async (request, response, next) => {
    try {
      const auth = requireAuth(request);
      const query = timeseriesQuerySchema.parse(request.query);
      const tenant = await requireTenant(pool, auth.userId);
      const points = await getTimeseries(pool, tenant.id, query.range, query.event);

      response.status(200).json({ points });
    } catch (error) {
      next(error);
    }
  });

  app.get("/stats/realtime", async (request, response, next) => {
    try {
      const auth = requireAuth(request);
      const tenant = await requireTenant(pool, auth.userId);
      const stats = await getRealtimeStats(pool, tenant.id);

      response.status(200).json(stats);
    } catch (error) {
      next(error);
    }
  });

  app.get("/events", async (request, response, next) => {
    try {
      const auth = requireAuth(request);
      const query = eventsQuerySchema.parse(request.query);
      const tenant = await requireTenant(pool, auth.userId);
      const events = await getEventLog(pool, tenant.id, query.limit, query.offset);

      response.status(200).json({ events, limit: query.limit, offset: query.offset });
    } catch (error) {
      next(error);
    }
  });

  app.get("/funnels", (_request, response) => {
    response.status(200).json({ funnels: [] });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) {
      return;
    }

    if (error instanceof ZodError) {
      response.status(400).json({ error: "Invalid request", issues: error.issues });
      return;
    }

    if (error instanceof Error && error.name === "TenantNotFoundError") {
      response.status(404).json({ error: "Tenant has not been set up" });
      return;
    }

    response.status(500).json({ error: "Internal server error" });
  });

  return app;
}

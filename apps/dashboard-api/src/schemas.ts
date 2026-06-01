import { z } from "zod";

export const rangeSchema = z.enum(["24h", "7d", "30d"]);

export const overviewQuerySchema = z.object({
  range: rangeSchema.default("24h")
});

export const timeseriesQuerySchema = z.object({
  range: rangeSchema.default("7d"),
  event: z.string().trim().min(1).max(128).optional()
});

export const eventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0)
});

export const tenantSetupSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

export const tenantDomainsSchema = z.object({
  domains: z.array(z.string().trim().min(1).max(255)).max(50)
});

export const funnelStepSchema = z.object({
  event: z.string().trim().min(1).max(120)
});

export const funnelCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  steps: z.array(funnelStepSchema).min(1).max(12)
});

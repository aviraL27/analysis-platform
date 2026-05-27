import { z } from "zod";
import type { EventQueueJob } from "@analytiq/types";

export const eventQueueJobSchema = z
  .object({
    tenantId: z.string().uuid(),
    eventName: z.string().trim().min(1).max(128),
    properties: z.record(z.unknown()),
    sessionId: z.string().uuid(),
    url: z.string().url().max(2048),
    referrer: z.string().url().max(2048).optional(),
    occurredAt: z.string().datetime({ offset: true }),
    userAgent: z.string().max(1024).optional(),
    ipAddress: z.string().optional()
  })
  .strict();

export function parseEventQueueJob(value: unknown): EventQueueJob {
  const parsed = eventQueueJobSchema.parse(value);
  const job: EventQueueJob = {
    tenantId: parsed.tenantId,
    eventName: parsed.eventName,
    properties: parsed.properties,
    sessionId: parsed.sessionId,
    url: parsed.url,
    occurredAt: parsed.occurredAt
  };

  if (parsed.referrer) {
    job.referrer = parsed.referrer;
  }

  if (parsed.userAgent) {
    job.userAgent = parsed.userAgent;
  }

  if (parsed.ipAddress) {
    job.ipAddress = parsed.ipAddress;
  }

  return job;
}

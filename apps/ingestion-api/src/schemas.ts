import { z } from "zod";

export const ingestSchema = z
  .object({
    token: z.string().uuid(),
    eventName: z.string().trim().min(1).max(128),
    properties: z.record(z.unknown()).default({}),
    sessionId: z.string().uuid(),
    url: z.string().url().max(2048),
    referrer: z.string().url().max(2048).optional(),
    occurredAt: z.string().datetime({ offset: true }).default(() => new Date().toISOString()),
    userAgent: z.string().max(1024).optional()
  })
  .strict();

export type ParsedIngestPayload = z.infer<typeof ingestSchema>;

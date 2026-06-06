import { z } from "zod";

// eventName: alphanumeric, underscores, hyphens, dots — max 100 chars
const eventNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^[a-zA-Z0-9_\-\.]+$/,
    "eventName must contain only letters, numbers, underscores, hyphens, or dots"
  );

// properties: capped at 10 KB serialised to prevent oversized payloads
const propertiesSchema = z
  .record(z.unknown())
  .default({})
  .superRefine((val, ctx) => {
    const serialised = JSON.stringify(val);
    if (serialised.length > 10_240) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "properties payload must not exceed 10 KB"
      });
    }
  });

export const ingestSchema = z
  .object({
    token: z.string().uuid(),
    eventName: eventNameSchema,
    properties: propertiesSchema,
    sessionId: z.string().uuid(),
    url: z.string().url().max(2048),
    referrer: z.string().url().max(2048).optional(),
    occurredAt: z.string().datetime({ offset: true }).default(() => new Date().toISOString()),
    userAgent: z.string().max(1024).optional()
  })
  .strict();

export type ParsedIngestPayload = z.infer<typeof ingestSchema>;

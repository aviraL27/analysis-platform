export type RangeKey = "24h" | "7d" | "30d";

export interface CachedTenant {
  id: string;
  token: string;
  domainWhitelist: string[];
  plan: string;
}

export interface IngestEventPayload {
  token: string;
  eventName: string;
  properties: Record<string, unknown>;
  sessionId: string;
  url: string;
  referrer?: string;
  occurredAt: string;
  userAgent?: string;
}

export interface EventQueueJob {
  tenantId: string;
  eventName: string;
  properties: Record<string, unknown>;
  sessionId: string;
  url: string;
  referrer?: string;
  occurredAt: string;
  userAgent?: string;
  ipAddress?: string;
}

import { createHash } from "node:crypto";
import UAParser from "ua-parser-js";
import type { EventQueueJob } from "@analytiq/types";

export interface ProcessedEvent {
  time: Date;
  tenantId: string;
  eventName: string;
  properties: Record<string, unknown>;
  sessionId: string;
  url: string;
  referrer?: string;
  country?: string;
  device?: string;
  os?: string;
  browser?: string;
  ipHash?: string;
}

function compact(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function truncateIpAddress(ipAddress: string): string {
  const normalized = ipAddress.replace(/^::ffff:/, "").trim();

  if (normalized.includes(".")) {
    const parts = normalized.split(".");

    if (parts.length === 4) {
      return `${parts.slice(0, 3).join(".")}.0`;
    }
  }

  if (normalized.includes(":")) {
    const parts = normalized.split(":");
    return `${parts.slice(0, Math.max(parts.length - 2, 1)).join(":")}::`;
  }

  return normalized;
}

export function anonymizeIp(ipAddress: string | undefined): string | undefined {
  if (!ipAddress) {
    return undefined;
  }

  const truncated = truncateIpAddress(ipAddress);

  if (!truncated) {
    return undefined;
  }

  return createHash("sha256").update(truncated).digest("hex");
}

export function processEvent(job: EventQueueJob): ProcessedEvent {
  const parser = new UAParser(job.userAgent);
  const result = parser.getResult();
  const deviceType = result.device.type ?? "desktop";
  const processed: ProcessedEvent = {
    time: new Date(job.occurredAt),
    tenantId: job.tenantId,
    eventName: job.eventName,
    properties: job.properties,
    sessionId: job.sessionId,
    url: job.url
  };
  const device = compact(deviceType);
  const os = compact(result.os.name);
  const browser = compact(result.browser.name);
  const ipHash = anonymizeIp(job.ipAddress);

  if (job.referrer) {
    processed.referrer = job.referrer;
  }

  if (device) {
    processed.device = device;
  }

  if (os) {
    processed.os = os;
  }

  if (browser) {
    processed.browser = browser;
  }

  if (ipHash) {
    processed.ipHash = ipHash;
  }

  return processed;
}

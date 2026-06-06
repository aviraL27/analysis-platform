export interface AnalytiqConfig {
  token: string;
  endpoint?: string;
  autoPageviews?: boolean;
  autoClicks?: boolean;
  sessionStorageKey?: string;
  onDelivery?: (result: DeliveryResult) => void;
}

export interface TrackOptions {
  properties?: Record<string, unknown>;
  url?: string;
  referrer?: string;
}

export interface DeliveryResult {
  eventName: string;
  ok: boolean;
  status?: number;
  error?: string;
}

interface IngestPayload {
  token: string;
  eventName: string;
  properties: Record<string, unknown>;
  sessionId: string;
  url: string;
  occurredAt: string;
  referrer?: string;
  userAgent?: string;
}

const defaultEndpoint = "http://localhost:3001/ingest";
const defaultSessionStorageKey = "analytiq.session_id";
let activeConfig: Required<Pick<AnalytiqConfig, "token" | "endpoint" | "sessionStorageKey">> | undefined;
let deliveryCallback: AnalytiqConfig["onDelivery"];
let clickListener: ((event: MouseEvent) => void) | undefined;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (character) => {
    const value = Number(character);
    return (value ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (value / 4)))).toString(16);
  });
}

function getSessionId(storageKey: string): string {
  if (!isBrowser()) {
    return createId();
  }

  const existing = window.sessionStorage.getItem(storageKey);

  if (existing) {
    return existing;
  }

  const sessionId = createId();
  window.sessionStorage.setItem(storageKey, sessionId);
  return sessionId;
}

function currentUrl(): string {
  return isBrowser() ? window.location.href : "";
}

function currentReferrer(): string | undefined {
  if (!isBrowser() || !document.referrer) {
    return undefined;
  }

  return document.referrer;
}

function getClickProperties(target: EventTarget | null): Record<string, unknown> {
  if (!(target instanceof Element)) {
    return {};
  }

  const element = target.closest("a, button, input, select, textarea, [data-analytiq-id]") ?? target;
  const properties: Record<string, unknown> = {
    tag: element.tagName.toLowerCase()
  };
  const analyticsId = element.getAttribute("data-analytiq-id");
  const text = element.textContent?.trim().replace(/\s+/g, " ").slice(0, 120);

  if (analyticsId) {
    properties.id = analyticsId;
  }

  if (text) {
    properties.text = text;
  }

  if (element instanceof HTMLAnchorElement) {
    properties.href = element.href;
  }

  return properties;
}

function reportDelivery(result: DeliveryResult): void {
  deliveryCallback?.(result);
}

function send(payload: IngestPayload, endpoint: string): void {
  const body = JSON.stringify(payload);

  if (!deliveryCallback && isBrowser() && navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });

    if (navigator.sendBeacon(endpoint, blob)) {
      return;
    }
  }

  void fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body,
    keepalive: true
  })
    .then(async (response) => {
      if (response.ok) {
        reportDelivery({ eventName: payload.eventName, ok: true, status: response.status });
        return;
      }

      const body = (await response.json().catch(() => ({}))) as { error?: unknown };
      reportDelivery({
        eventName: payload.eventName,
        ok: false,
        status: response.status,
        error: typeof body.error === "string" ? body.error : `Request failed with ${response.status}`
      });
    })
    .catch((error: unknown) => {
      reportDelivery({
        eventName: payload.eventName,
        ok: false,
        error: error instanceof Error ? error.message : "Network request failed"
      });
    });
}

export function init(config: AnalytiqConfig): void {
  activeConfig = {
    token: config.token,
    endpoint: config.endpoint ?? defaultEndpoint,
    sessionStorageKey: config.sessionStorageKey ?? defaultSessionStorageKey
  };
  deliveryCallback = config.onDelivery;

  if (config.autoClicks ?? true) {
    enableClickTracking();
  }

  if (config.autoPageviews ?? true) {
    page();
  }
}

export function track(eventName: string, options: TrackOptions = {}): void {
  if (!activeConfig) {
    throw new Error("Analytiq has not been initialized");
  }

  const payload: IngestPayload = {
    token: activeConfig.token,
    eventName,
    properties: options.properties ?? {},
    sessionId: getSessionId(activeConfig.sessionStorageKey),
    url: options.url ?? currentUrl(),
    occurredAt: new Date().toISOString()
  };
  const referrer = options.referrer ?? currentReferrer();

  if (referrer) {
    payload.referrer = referrer;
  }

  if (isBrowser()) {
    payload.userAgent = navigator.userAgent;
  }

  send(payload, activeConfig.endpoint);
}

export function page(properties: Record<string, unknown> = {}): void {
  track("pageview", { properties });
}

export function enableClickTracking(): void {
  if (!isBrowser() || clickListener) {
    return;
  }

  clickListener = (event: MouseEvent) => {
    track("click", {
      properties: getClickProperties(event.target)
    });
  };
  document.addEventListener("click", clickListener, { capture: true });
}

export function disableClickTracking(): void {
  if (!isBrowser() || !clickListener) {
    return;
  }

  document.removeEventListener("click", clickListener, { capture: true });
  clickListener = undefined;
}

export const version = "0.1.0";

declare global {
  interface Window {
    analytiq?: {
      init: typeof init;
      track: typeof track;
      page: typeof page;
      enableClickTracking: typeof enableClickTracking;
      disableClickTracking: typeof disableClickTracking;
      version: typeof version;
    };
  }
}

if (isBrowser()) {
  window.analytiq = {
    init,
    track,
    page,
    enableClickTracking,
    disableClickTracking,
    version
  };
}

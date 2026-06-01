export type RangeKey = "24h" | "7d" | "30d";

export interface Tenant {
  id: string;
  name: string;
  token: string;
  domainWhitelist: string[];
  plan: string;
}

export interface TopCount {
  value: string;
  count: number;
}

export interface OverviewStats {
  totalEvents: number;
  uniqueSessions: number;
  topPages: TopCount[];
  topReferrers: TopCount[];
}

export interface TimeseriesPoint {
  bucket: string;
  count: number;
}

export interface RealtimeStats {
  activeUsers: number;
  eventsLast30Minutes: number;
}

export interface EventLogRow {
  time: string;
  eventName: string;
  properties: Record<string, unknown>;
  sessionId: string;
  url: string | null;
  referrer: string | null;
  country: string | null;
  device: string | null;
  os: string | null;
  browser: string | null;
}

export interface FunnelStep {
  event: string;
}

export interface Funnel {
  id: string;
  name: string;
  steps: FunnelStep[];
  createdAt: string;
}

const apiBaseUrl = import.meta.env.VITE_DASHBOARD_API_URL ?? "http://localhost:3002";

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...init.headers
    }
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export const dashboardApi = {
  apiBaseUrl,
  tenant(token: string) {
    return request<{ tenant: Tenant }>(token, "/tenant");
  },
  setupTenant(token: string, name: string) {
    return request<{ tenant: Tenant }>(token, "/tenants/setup", {
      method: "POST",
      body: JSON.stringify({ name })
    });
  },
  updateDomains(token: string, domains: string[]) {
    return request<{ tenant: Tenant }>(token, "/tenants/domains", {
      method: "PUT",
      body: JSON.stringify({ domains })
    });
  },
  overview(token: string, range: RangeKey) {
    return request<OverviewStats>(token, `/stats/overview?range=${range}`);
  },
  timeseries(token: string, range: RangeKey, eventName: string) {
    const params = new URLSearchParams({ range });

    if (eventName.trim()) {
      params.set("event", eventName.trim());
    }

    return request<{ points: TimeseriesPoint[] }>(token, `/stats/timeseries?${params.toString()}`);
  },
  realtime(token: string) {
    return request<RealtimeStats>(token, "/stats/realtime");
  },
  events(token: string, limit = 50, offset = 0) {
    return request<{ events: EventLogRow[]; limit: number; offset: number }>(
      token,
      `/events?limit=${limit}&offset=${offset}`
    );
  },
  funnels(token: string) {
    return request<{ funnels: Funnel[] }>(token, "/funnels");
  },
  createFunnel(token: string, name: string, steps: FunnelStep[]) {
    return request<{ funnel: Funnel }>(token, "/funnels", {
      method: "POST",
      body: JSON.stringify({ name, steps })
    });
  }
};

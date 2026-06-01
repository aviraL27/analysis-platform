import { useCallback, useEffect, useMemo, useState } from "react";
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { io } from "socket.io-client";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  dashboardApi,
  type EventLogRow,
  type OverviewStats,
  type RangeKey,
  type RealtimeStats,
  type Tenant,
  type TimeseriesPoint
} from "./api";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : undefined;

interface LiveEvent {
  time: string;
  eventName: string;
  url?: string;
  sessionId: string;
}

const emptyOverview: OverviewStats = {
  totalEvents: 0,
  uniqueSessions: 0,
  topPages: [],
  topReferrers: []
};

const emptyRealtime: RealtimeStats = {
  activeUsers: 0,
  eventsLast30Minutes: 0
};

function useAccessToken(client: SupabaseClient | undefined) {
  const [session, setSession] = useState<Session | null>(null);
  const [manualToken, setManualToken] = useState(() => window.sessionStorage.getItem("analytiq.jwt") ?? "");

  useEffect(() => {
    if (!client) {
      return undefined;
    }

    void client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => data.subscription.unsubscribe();
  }, [client]);

  const saveManualToken = useCallback((token: string) => {
    setManualToken(token);
    if (token.trim()) {
      window.sessionStorage.setItem("analytiq.jwt", token);
      return;
    }

    window.sessionStorage.removeItem("analytiq.jwt");
  }, []);

  const signOut = useCallback(async () => {
    setSession(null);
    setManualToken("");
    window.sessionStorage.removeItem("analytiq.jwt");
    window.localStorage.removeItem("analytiq.jwt");
    await client?.auth.signOut();
  }, [client]);

  return {
    session,
    accessToken: session?.access_token ?? manualToken.trim(),
    manualToken,
    saveManualToken,
    signOut
  };
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function LoginPanel({
  client,
  manualToken,
  onManualToken
}: {
  client: SupabaseClient | undefined;
  manualToken: string;
  onManualToken: (token: string) => void;
}) {
  return (
    <main className="login-shell">
      <section className="login-panel">
        <div>
          <p className="eyebrow">Analytiq</p>
          <h1>Self-hosted product analytics</h1>
          <p className="muted">Sign in with Supabase or paste a local JWT to open the dashboard.</p>
        </div>

        {client ? <Auth supabaseClient={client} appearance={{ theme: ThemeSupa }} /> : null}

        <label className="field">
          <span>JWT access token</span>
          <textarea
            rows={5}
            value={manualToken}
            onChange={(event) => onManualToken(event.target.value)}
            placeholder="Paste a Supabase JWT for local development"
          />
        </label>
      </section>
    </main>
  );
}

function TenantSetup({ token, onReady }: { token: string; onReady: (tenant: Tenant) => void }) {
  const [name, setName] = useState("My workspace");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const result = await dashboardApi.setupTenant(token, name);
      onReady(result.tenant);
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Could not create tenant");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={submit}>
        <div>
          <p className="eyebrow">First run</p>
          <h1>Create your analytics tenant</h1>
          <p className="muted">This generates the site token your SDK snippet will use.</p>
        </div>
        <label className="field">
          <span>Workspace name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button className="primary" type="submit" disabled={saving}>
          {saving ? "Creating..." : "Create tenant"}
        </button>
      </form>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <section className="metric">
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </section>
  );
}

function Ranking({ title, rows }: { title: string; rows: { value: string; count: number }[] }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{title}</h2>
      </div>
      <div className="ranking">
        {rows.length === 0 ? <p className="muted">No data yet.</p> : null}
        {rows.map((row) => (
          <div className="rank-row" key={row.value}>
            <span title={row.value}>{row.value}</span>
            <strong>{formatCount(row.count)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function DomainsEditor({
  token,
  tenant,
  onTenant
}: {
  token: string;
  tenant: Tenant;
  onTenant: (tenant: Tenant) => void;
}) {
  const [domains, setDomains] = useState(tenant.domainWhitelist.join("\n"));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDomains(tenant.domainWhitelist.join("\n"));
  }, [tenant.domainWhitelist]);

  async function save() {
    setSaving(true);

    try {
      const nextDomains = domains
        .split(/\r?\n|,/)
        .map((domain) => domain.trim())
        .filter(Boolean);
      const result = await dashboardApi.updateDomains(token, nextDomains);
      onTenant(result.tenant);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel settings-panel">
      <div className="panel-heading">
        <h2>Tenant</h2>
        <button onClick={save} disabled={saving}>
          {saving ? "Saving" : "Save"}
        </button>
      </div>
      <label className="field">
        <span>SDK token</span>
        <input readOnly value={tenant.token} />
      </label>
      <label className="field">
        <span>Allowed domains</span>
        <textarea
          rows={4}
          value={domains}
          onChange={(event) => setDomains(event.target.value)}
          placeholder="example.com"
        />
      </label>
    </section>
  );
}

function EventTable({ events }: { events: EventLogRow[] }) {
  return (
    <section className="panel wide">
      <div className="panel-heading">
        <h2>Raw Events</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>URL</th>
              <th>Session</th>
              <th>Device</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={`${event.time}-${event.sessionId}-${event.eventName}`}>
                <td>{formatTime(event.time)}</td>
                <td>{event.eventName}</td>
                <td title={event.url ?? ""}>{event.url ?? "-"}</td>
                <td>{event.sessionId.slice(0, 8)}</td>
                <td>{[event.device, event.browser].filter(Boolean).join(" / ") || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function App() {
  const { session, accessToken, manualToken, saveManualToken, signOut } = useAccessToken(supabase);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [range, setRange] = useState<RangeKey>("7d");
  const [eventName, setEventName] = useState("pageview");
  const [overview, setOverview] = useState<OverviewStats>(emptyOverview);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [realtime, setRealtime] = useState<RealtimeStats>(emptyRealtime);
  const [events, setEvents] = useState<EventLogRow[]>([]);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const chartData = useMemo(
    () =>
      timeseries.map((point) => ({
        ...point,
        label: formatTime(point.bucket)
      })),
    [timeseries]
  );

  const refresh = useCallback(async () => {
    if (!accessToken) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [tenantResult, nextOverview, nextTimeseries, nextRealtime, nextEvents] = await Promise.all([
        dashboardApi.tenant(accessToken),
        dashboardApi.overview(accessToken, range),
        dashboardApi.timeseries(accessToken, range, eventName),
        dashboardApi.realtime(accessToken),
        dashboardApi.events(accessToken)
      ]);
      setTenant(tenantResult.tenant);
      setOverview(nextOverview);
      setTimeseries(nextTimeseries.points);
      setRealtime(nextRealtime);
      setEvents(nextEvents.events);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Could not load dashboard");
    } finally {
      setLoading(false);
    }
  }, [accessToken, eventName, range]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!accessToken || !tenant) {
      return undefined;
    }

    const socket = io(dashboardApi.apiBaseUrl, {
      transports: ["websocket"],
      auth: {
        token: accessToken
      }
    });

    socket.on("event", (event: LiveEvent) => {
      setLiveEvents((current) => [event, ...current].slice(0, 10));
      void refresh();
    });

    return () => {
      socket.close();
    };
  }, [accessToken, refresh, tenant]);

  if (!accessToken) {
    return <LoginPanel client={supabase} manualToken={manualToken} onManualToken={saveManualToken} />;
  }

  async function handleSignOut() {
    await signOut();
    setTenant(null);
    setOverview(emptyOverview);
    setTimeseries([]);
    setRealtime(emptyRealtime);
    setEvents([]);
    setLiveEvents([]);
    setError(null);
  }

  if (!tenant && !loading && error === "Tenant has not been set up") {
    return <TenantSetup token={accessToken} onReady={(nextTenant) => {
      setTenant(nextTenant);
      setError(null);
      void refresh();
    }} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Analytiq</p>
          <h1>{tenant?.name ?? "Dashboard"}</h1>
        </div>
        <nav>
          <a href="#overview">Overview</a>
          <a href="#events">Events</a>
          <a href="#tenant">Tenant</a>
        </nav>
        <div className="session-box">
          <span>{session?.user.email ?? "Manual JWT"}</span>
          <button onClick={() => void handleSignOut()}>Sign out</button>
        </div>
      </aside>

      <main className="dashboard">
        <header className="topbar">
          <div>
            <p className="eyebrow">Live analytics</p>
            <h2>Traffic, events, and sessions</h2>
          </div>
          <div className="controls">
            <select value={range} onChange={(event) => setRange(event.target.value as RangeKey)}>
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
            </select>
            <input value={eventName} onChange={(event) => setEventName(event.target.value)} />
            <button onClick={() => void refresh()} disabled={loading}>
              {loading ? "Loading" : "Refresh"}
            </button>
          </div>
        </header>

        {error ? <p className="error">{error}</p> : null}

        <section className="metrics" id="overview">
          <Metric label="Total events" value={formatCount(overview.totalEvents)} />
          <Metric label="Unique sessions" value={formatCount(overview.uniqueSessions)} />
          <Metric label="Active now" value={formatCount(realtime.activeUsers)} />
          <Metric label="Last 30 minutes" value={formatCount(realtime.eventsLast30Minutes)} />
        </section>

        <section className="grid">
          <section className="panel wide">
            <div className="panel-heading">
              <h2>Event Volume</h2>
              <span>{eventName || "All events"}</span>
            </div>
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" minTickGap={24} tickLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} width={42} />
                  <Tooltip />
                  <Area type="monotone" dataKey="count" stroke="#2563eb" fill="#93c5fd" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <Ranking title="Top Pages" rows={overview.topPages} />
          <Ranking title="Top Referrers" rows={overview.topReferrers} />

          <section className="panel">
            <div className="panel-heading">
              <h2>Live Stream</h2>
            </div>
            <div className="live-list">
              {liveEvents.length === 0 ? <p className="muted">Waiting for worker events.</p> : null}
              {liveEvents.map((event) => (
                <div className="live-row" key={`${event.time}-${event.sessionId}`}>
                  <strong>{event.eventName}</strong>
                  <span>{event.url ?? "-"}</span>
                </div>
              ))}
            </div>
          </section>

          <div id="tenant">{tenant ? <DomainsEditor token={accessToken} tenant={tenant} onTenant={setTenant} /> : null}</div>
          <div id="events" className="wide">
            <EventTable events={events} />
          </div>
        </section>
      </main>
    </div>
  );
}

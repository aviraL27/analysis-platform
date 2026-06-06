import { useCallback, useEffect, useMemo, useState, useRef } from "react";
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
  type Funnel,
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

interface SyslogEntry {
  ts: string;
  level: "INFO" | "WARN" | "ERR" | "DEBUG" | "OK";
  msg: string;
}

const LOG_TEMPLATES = [
  { level: "INFO" as const, msg: "Request processed: GET /stats/overview (200 OK)" },
  { level: "INFO" as const, msg: "Redis cache hit for tenant token." },
  { level: "DEBUG" as const, msg: "Worker thread flushed batch to database." },
  { level: "WARN" as const, msg: "Slow query detected: SELECT count(*) FROM events (124ms)" },
  { level: "INFO" as const, msg: "Socket.io client connected to room: tenant-room-main" },
  { level: "INFO" as const, msg: "User agent parsed: Chrome/Safari on desktop." },
  { level: "OK" as const, msg: "Worker realtime emission successful." },
  { level: "INFO" as const, msg: "Hourly stats aggregation complete for bucket." },
  { level: "DEBUG" as const, msg: "Garbage collection execution: freed 1.8MB." },
  { level: "WARN" as const, msg: "Redis token cache TTL expired, refreshing connection." },
  { level: "ERR" as const, msg: "Connection pool warning: temporary queue build-up." },
  { level: "OK" as const, msg: "Database health check verification successful." }
];

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
  const [authReady, setAuthReady] = useState(!client);
  const [manualToken, setManualToken] = useState(() => window.sessionStorage.getItem("analytiq.jwt") ?? "");

  useEffect(() => {
    if (!client) {
      setAuthReady(true);
      return undefined;
    }

    let active = true;

    void client.auth.getSession().then(({ data }) => {
      if (!active) {
        return;
      }

      setSession(data.session);
      setAuthReady(true);
    });

    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);

      if (nextSession?.access_token) {
        setManualToken("");
        window.sessionStorage.removeItem("analytiq.jwt");
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
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

  const accessToken = session?.access_token ?? (authReady ? manualToken.trim() : "");

  return {
    session,
    accessToken,
    authReady,
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

// Sparkline Component
function Sparkline({ color, points }: { color: string; points: number[] }) {
  const width = 100;
  const height = 20;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const formattedPoints = points
    .map((p, idx) => {
      const x = (idx / (points.length - 1)) * width;
      const y = height - ((p - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width="100%" height="20" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={formattedPoints} />
    </svg>
  );
}

// SVG Icons
function DashboardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </svg>
  );
}

function MetricsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function TelemetryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function LogsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function DatabasesIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
    </svg>
  );
}

function DeploymentsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

function AlertsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function CustomTooltip({ active, payload }: any) {
  if (active && payload && payload.length) {
    return (
      <div
        style={{
          background: "var(--tooltip-bg)",
          color: "var(--tooltip-color)",
          border: "1px solid var(--tooltip-border)",
          fontFamily: 'JetBrains Mono, "Courier New", monospace',
          fontSize: "11px",
          padding: "8px 12px",
          borderRadius: "3px",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)"
        }}
      >
        <p style={{ margin: 0, opacity: 0.6 }}>[TS] {payload[0].payload.label}</p>
        <p style={{ margin: "4px 0 0 0", color: "var(--accent-primary)", fontWeight: "bold" }}>
          [EVENTS] {payload[0].value}
        </p>
      </div>
    );
  }
  return null;
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
    <main className="login-shell grid-bg">
      <div className="scanlines" />
      <section className="login-panel terminal-card">
        <div className="terminal-card-header">
          <div className="terminal-card-title">
            <span className="terminal-card-dot active" />
            <span>sys_auth.sh</span>
          </div>
          <div className="terminal-card-controls">
            <span className="terminal-card-dot" />
            <span className="terminal-card-dot" />
          </div>
        </div>
        <div className="terminal-card-body" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <p className="eyebrow">Analytiq OS</p>
            <h1>Self-hosted developer analytics</h1>
            <p className="muted">Sign in with Supabase or enter a local JWT to initialize terminal.</p>
          </div>

          {client ? (
            <Auth
              supabaseClient={client}
              appearance={{ theme: ThemeSupa }}
              providers={["google", "github"]}
            />
          ) : null}

          <label className="field">
            <span>JWT access token</span>
            <textarea
              rows={4}
              value={manualToken}
              onChange={(event) => onManualToken(event.target.value)}
              placeholder="Paste a Supabase JWT for local development"
              style={{ border: "1px solid var(--border)", borderRadius: "3px" }}
            />
          </label>
        </div>
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
    <main className="login-shell grid-bg">
      <div className="scanlines" />
      <form className="login-panel terminal-card" onSubmit={submit}>
        <div className="terminal-card-header">
          <div className="terminal-card-title">
            <span className="terminal-card-dot active" />
            <span>tenant_provision.sh</span>
          </div>
        </div>
        <div className="terminal-card-body" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <p className="eyebrow">First run</p>
            <h1>Provision Analytics Tenant</h1>
            <p className="muted">This generates the unique SDK token used by the JS tracker snippet.</p>
          </div>
          <label className="field">
            <span>Workspace name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button className="primary-btn" type="submit" disabled={saving}>
            {saving ? "Provisioning..." : "PROVISION"}
          </button>
        </div>
      </form>
    </main>
  );
}

function MetricCard({
  label,
  value,
  delta,
  points,
  status
}: {
  label: string;
  value: string;
  delta: { val: string; isUp: boolean };
  points: number[];
  status: "ok" | "warn" | "err";
}) {
  const statusColor = status === "ok" ? "active" : "";

  return (
    <section className="terminal-card">
      <div className="terminal-card-header">
        <span className="terminal-card-title">{label}</span>
        <div className="terminal-card-controls">
          <span className={`terminal-card-dot ${statusColor}`} />
        </div>
      </div>
      <div className="terminal-card-body">
        <div className="metric-module">
          <div className="metric-value-row">
            <div className="metric-value">{value}</div>
            <div className={`metric-delta ${delta.isUp ? "up" : "down"}`}>
              {delta.isUp ? "▲" : "▼"} {delta.val}
            </div>
          </div>
          <div className="sparkline-container">
            <Sparkline color={delta.isUp ? "#16a34a" : "#dc2626"} points={points} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Ranking({ title, rows }: { title: string; rows: { value: string; count: number }[] }) {
  return (
    <section className="terminal-card">
      <div className="terminal-card-header">
        <div className="terminal-card-title">{title}</div>
      </div>
      <div className="terminal-card-body" style={{ padding: 0 }}>
        <div className="ranking">
          {rows.length === 0 ? (
            <p className="muted" style={{ padding: "16px" }}>
              No telemetry data.
            </p>
          ) : null}
          {rows.map((row) => (
            <div className="rank-row" key={row.value}>
              <span className="mono" title={row.value} style={{ fontSize: "12px" }}>
                {row.value}
              </span>
              <strong className="mono">{formatCount(row.count)}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FunnelsPanel({
  token,
  funnels,
  onFunnel
}: {
  token: string;
  funnels: Funnel[];
  onFunnel: (funnel: Funnel) => void;
}) {
  const [name, setName] = useState("Signup conversion");
  const [steps, setSteps] = useState("pageview\nsignup\nupgrade");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setSaving(true);
    setError(null);

    try {
      const parsedSteps = steps
        .split(/\r?\n|,/)
        .map((value) => value.trim())
        .filter(Boolean)
        .map((event) => ({ event }));
      const result = await dashboardApi.createFunnel(token, name, parsedSteps);
      onFunnel(result.funnel);
    } catch (funnelError) {
      setError(funnelError instanceof Error ? funnelError.message : "Could not create funnel");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="terminal-card wide-panel" id="funnels">
      <div className="terminal-card-header">
        <div className="terminal-card-title">~/config/funnel_aggregates.log</div>
      </div>
      <div className="terminal-card-body">
        <div className="funnel-creator">
          <div className="funnel-form-panel">
            <label className="field">
              <span>Funnel Identifier</span>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="field">
              <span>Required Steps (one per line)</span>
              <textarea
                rows={3}
                value={steps}
                onChange={(event) => setSteps(event.target.value)}
                placeholder="pageview&#10;signup&#10;purchase"
              />
            </label>
            {error ? <p className="error">{error}</p> : null}
            <button className="primary-btn" onClick={() => void create()} disabled={saving}>
              {saving ? "AGGREGATING..." : "BUILD FUNNEL"}
            </button>
          </div>
          <div className="funnel-list-scroll">
            {funnels.length === 0 ? (
              <p className="muted" style={{ padding: "12px" }}>
                No active funnels configured.
              </p>
            ) : null}
            {funnels.map((funnel) => (
              <div className="funnel-card" key={funnel.id}>
                <div>
                  <strong style={{ fontSize: "13px" }}>{funnel.name}</strong>
                  <div className="funnel-info-steps">
                    {funnel.steps.map((step) => step.event).join(" -> ")}
                  </div>
                </div>
                <span className="mono" style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  {new Date(funnel.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
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
    <section className="terminal-card">
      <div className="terminal-card-header">
        <div className="terminal-card-title">~/config/tenant_whitelist.cfg</div>
        <button onClick={() => void save()} disabled={saving} style={{ fontSize: "11px", padding: "3px 8px" }}>
          {saving ? "SAVING" : "COMMIT"}
        </button>
      </div>
      <div className="terminal-card-body settings-layout">
        <label className="field">
          <span>Client SDK Token</span>
          <input readOnly value={tenant.token} className="mono" style={{ fontSize: "12px", background: "var(--surface-secondary)" }} />
        </label>
        <label className="field">
          <span>Allowed Whitelist Domains</span>
          <textarea
            rows={3}
            value={domains}
            onChange={(event) => setDomains(event.target.value)}
            placeholder="localhost"
            className="mono"
            style={{ fontSize: "12px" }}
          />
        </label>
      </div>
    </section>
  );
}

function EventTable({ events }: { events: EventLogRow[] }) {
  return (
    <section className="terminal-card wide-panel">
      <div className="terminal-card-header">
        <div className="terminal-card-title">~/telemetry/raw_ingested_events.log</div>
      </div>
      <div className="terminal-card-body" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Event Type</th>
                <th>Endpoint/URL</th>
                <th>Session ID</th>
                <th>Node Agent</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event, idx) => (
                <tr key={`${event.time}-${event.sessionId}-${event.eventName}-${idx}`}>
                  <td className="mono">{formatTime(event.time)}</td>
                  <td className="mono" style={{ fontWeight: 700, color: "var(--accent-secondary)" }}>
                    {event.eventName}
                  </td>
                  <td className="mono" title={event.url ?? ""} style={{ fontSize: "12px" }}>
                    {event.url ?? "-"}
                  </td>
                  <td className="mono" style={{ fontSize: "12px" }}>
                    {event.sessionId.slice(0, 8)}
                  </td>
                  <td className="mono" style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                    {[event.device, event.browser].filter(Boolean).join(" / ") || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function App() {
  const { session, accessToken, authReady, manualToken, saveManualToken, signOut } = useAccessToken(supabase);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [range, setRange] = useState<RangeKey>("7d");
  const [eventName, setEventName] = useState("pageview");
  const [debouncedEventName, setDebouncedEventName] = useState("pageview");
  const [overview, setOverview] = useState<OverviewStats>(emptyOverview);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [realtime, setRealtime] = useState<RealtimeStats>(emptyRealtime);
  const [events, setEvents] = useState<EventLogRow[]>([]);
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeMenuTab, setActiveMenuTab] = useState("Metrics");
  const [darkMode, setDarkMode] = useState(() => {
    const saved = window.localStorage.getItem("analytiq.theme");
    return saved === "dark";
  });

  // Apply theme to document root
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
    window.localStorage.setItem("analytiq.theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  // Simulated live stats state
  const [cpu, setCpu] = useState(62);
  const [memory, setMemory] = useState(79);
  const [queueSize, setQueueSize] = useState(128);
  const [dbRead, setDbRead] = useState(8.42);
  const [dbWrite, setDbWrite] = useState(1.12);
  const [activeConns, setActiveConns] = useState(8842);
  const [syslogs, setSyslogs] = useState<SyslogEntry[]>([
    { ts: "14:32:01.082", level: "INFO", msg: "Region_US_EAST node sync complete." },
    { ts: "14:32:04.115", level: "WARN", msg: "High memory pressure detected on worker-04." },
    { ts: "14:32:05.991", level: "OK", msg: "Connection pool expanded to 10k limits." },
    { ts: "14:32:10.200", level: "INFO", msg: "Auth_Service rotated secrets successfully." },
    { ts: "14:32:12.042", level: "ERR", msg: "Timeout waiting for downstream response from Cluster_02." },
    { ts: "14:32:15.551", level: "INFO", msg: "Garbage collection sweep finished in 42ms." }
  ]);

  const syslogConsoleRef = useRef<HTMLDivElement | null>(null);

  // Sparkline values (simulated static history)
  const sparklineData = useMemo(() => {
    return {
      requests: [12, 14, 15, 11, 16, 18, 14, 15, 19, 17, 21, 23, 20],
      errors: [0.02, 0.01, 0.01, 0.03, 0.01, 0.02, 0.01, 0.01, 0.01, 0.01, 0.01],
      latency: [8.5, 8.2, 8.9, 8.4, 8.1, 8.6, 9.2, 8.3, 8.5, 8.4, 8.2, 8.5],
      sessions: [110, 112, 115, 108, 119, 122, 120, 125, 122, 128, 131, 130]
    };
  }, []);

  const chartData = useMemo(
    () =>
      timeseries.map((point) => ({
        ...point,
        label: formatTime(point.bucket)
      })),
    [timeseries]
  );

  // Requests per second calculations
  const calculatedReqsSec = useMemo(() => {
    const totalLast30 = realtime.eventsLast30Minutes || 0;
    if (totalLast30 > 0) {
      return (totalLast30 / 1800).toFixed(2);
    }
    return (1.24 + Math.random() * 0.15).toFixed(2);
  }, [realtime.eventsLast30Minutes]);

  // Uptime display
  const calculatedThroughput = useMemo(() => {
    const eventsCount = realtime.eventsLast30Minutes || 0;
    const mbValue = (eventsCount * 260) / (1024 * 1024); // 260 bytes per average payload
    return `${mbValue.toFixed(3)} MB/30m`;
  }, [realtime.eventsLast30Minutes]);

  // Handle syslog scroll
  useEffect(() => {
    if (syslogConsoleRef.current) {
      syslogConsoleRef.current.scrollTop = syslogConsoleRef.current.scrollHeight;
    }
  }, [syslogs]);

  // Jitter simulated metrics to give operational "live" feel
  useEffect(() => {
    const metricsInterval = setInterval(() => {
      setCpu((curr) => {
        const diff = Math.floor(Math.random() * 7) - 3;
        const next = curr + diff;
        return Math.max(45, Math.min(95, next));
      });
      setMemory((curr) => {
        const diff = Math.floor(Math.random() * 3) - 1;
        const next = curr + diff;
        return Math.max(75, Math.min(85, next));
      });
      setQueueSize((curr) => {
        const diff = Math.floor(Math.random() * 11) - 5;
        const next = curr + diff;
        return Math.max(20, Math.min(1000, next));
      });
      setDbRead((curr) => {
        const diff = (Math.random() * 0.4) - 0.2;
        const next = Number((curr + diff).toFixed(2));
        return Math.max(5.0, Math.min(15.0, next));
      });
      setDbWrite((curr) => {
        const diff = (Math.random() * 0.1) - 0.05;
        const next = Number((curr + diff).toFixed(2));
        return Math.max(0.5, Math.min(2.5, next));
      });
      setActiveConns((curr) => {
        const diff = Math.floor(Math.random() * 5) - 2;
        return curr + diff;
      });
    }, 3500);

    // Syslog stream updater
    const syslogInterval = setInterval(() => {
      const template = LOG_TEMPLATES[Math.floor(Math.random() * LOG_TEMPLATES.length)];
      if (!template) {
        return;
      }
      const date = new Date();
      const timeStr = `${String(date.getHours()).padStart(2, "0")}:${String(
        date.getMinutes()
      ).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}.${String(
        date.getMilliseconds()
      ).padStart(3, "0")}`;

      setSyslogs((curr) => [...curr, { ts: timeStr, level: template.level, msg: template.msg }].slice(-15));
    }, 4500);

    return () => {
      clearInterval(metricsInterval);
      clearInterval(syslogInterval);
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedEventName(eventName), 300);
    return () => window.clearTimeout(timeout);
  }, [eventName]);

  const refresh = useCallback(async () => {
    if (!accessToken) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [tenantResult, nextOverview, nextTimeseries, nextRealtime, nextEvents, nextFunnels] = await Promise.all([
        dashboardApi.tenant(accessToken),
        dashboardApi.overview(accessToken, range),
        dashboardApi.timeseries(accessToken, range, debouncedEventName),
        dashboardApi.realtime(accessToken),
        dashboardApi.events(accessToken),
        dashboardApi.funnels(accessToken)
      ]);
      setTenant(tenantResult.tenant);
      setOverview(nextOverview);
      setTimeseries(nextTimeseries.points);
      setRealtime(nextRealtime);
      setEvents(nextEvents.events);
      setFunnels(nextFunnels.funnels);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Could not load dashboard");
    } finally {
      setLoading(false);
    }
  }, [accessToken, debouncedEventName, range]);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    void refresh();
  }, [authReady, refresh]);

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

  if (!authReady) {
    return (
      <main className="login-shell grid-bg">
        <section className="login-panel terminal-card">
          <p className="mono" style={{ fontSize: "13px" }}>
            BOOT_SEQUENCE: loading kernel elements...
          </p>
        </section>
      </main>
    );
  }

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
    setFunnels([]);
    setLiveEvents([]);
    setError(null);
  }

  if (!tenant && !loading && error === "Tenant has not been set up") {
    return (
      <TenantSetup
        token={accessToken}
        onReady={(nextTenant) => {
          setTenant(nextTenant);
          setError(null);
          void refresh();
        }}
      />
    );
  }

  const renderActiveBar = (percentage: number) => {
    const blocksCount = Math.round(percentage / 10);
    const filled = "█".repeat(blocksCount);
    const empty = "░".repeat(10 - blocksCount);
    return (
      <span className="ascii-bar">
        {filled}
        <span className="ascii-bar-empty">{empty}</span>
      </span>
    );
  };

  return (
    <div className="app-shell grid-bg">
      <div className="scanlines" />

      {/* LEFT SIDEBAR navigation */}
      <aside className="sidebar">
        <div>
          <div className="sidebar-brand">
            <p className="eyebrow" style={{ color: "var(--accent-primary)" }}>
              ANALYTIQ_OS
            </p>
            <p className="mono" style={{ fontSize: "10px", color: "var(--text-muted)" }}>
              v2.4.0-stable
            </p>
          </div>
          <nav>
            <a
              href="#overview"
              className={activeMenuTab === "Dashboard" ? "active" : ""}
              onClick={(e) => { e.preventDefault(); setActiveMenuTab("Dashboard"); document.getElementById("overview")?.scrollIntoView({ behavior: "smooth" }); }}
            >
              <DashboardIcon /> Dashboard
            </a>
            <a
              href="#overview"
              className={activeMenuTab === "Metrics" ? "active" : ""}
              onClick={(e) => { e.preventDefault(); setActiveMenuTab("Metrics"); document.getElementById("overview")?.scrollIntoView({ behavior: "smooth" }); }}
            >
              <MetricsIcon /> Metrics
            </a>
            <a
              href="#timeseries-chart"
              className={activeMenuTab === "Telemetry" ? "active" : ""}
              onClick={(e) => { e.preventDefault(); setActiveMenuTab("Telemetry"); document.getElementById("timeseries-chart")?.scrollIntoView({ behavior: "smooth" }); }}
            >
              <TelemetryIcon /> Telemetry
            </a>
            <a
              href="#events"
              className={activeMenuTab === "Logs" ? "active" : ""}
              onClick={(e) => { e.preventDefault(); setActiveMenuTab("Logs"); document.getElementById("events")?.scrollIntoView({ behavior: "smooth" }); }}
            >
              <LogsIcon /> Logs
            </a>
            <a
              href="#tenant"
              className={activeMenuTab === "Databases" ? "active" : ""}
              onClick={(e) => { e.preventDefault(); setActiveMenuTab("Databases"); document.getElementById("tenant")?.scrollIntoView({ behavior: "smooth" }); }}
            >
              <DatabasesIcon /> Databases
            </a>
            <a
              href="#funnels"
              className={activeMenuTab === "Deployments" ? "active" : ""}
              onClick={(e) => { e.preventDefault(); setActiveMenuTab("Deployments"); document.getElementById("funnels")?.scrollIntoView({ behavior: "smooth" }); }}
            >
              <DeploymentsIcon /> Deployments
            </a>
            <a
              href="#syslog-panel"
              className={activeMenuTab === "Alerts" ? "active" : ""}
              onClick={(e) => { e.preventDefault(); setActiveMenuTab("Alerts"); document.getElementById("syslog-panel")?.scrollIntoView({ behavior: "smooth" }); }}
            >
              <AlertsIcon /> Alerts
            </a>
            <a
              href="#tenant"
              className={activeMenuTab === "Settings" ? "active" : ""}
              onClick={(e) => { e.preventDefault(); setActiveMenuTab("Settings"); document.getElementById("tenant")?.scrollIntoView({ behavior: "smooth" }); }}
            >
              <SettingsIcon /> Settings
            </a>
          </nav>
        </div>

        <div className="sidebar-bottom">
          <button className="theme-toggle" onClick={() => setDarkMode((prev) => !prev)} title="Toggle dark/light mode">
            {darkMode ? <SunIcon /> : <MoonIcon />}
            <span className="theme-label">{darkMode ? "Light" : "Dark"}</span>
          </button>
          <button className="deploy-btn" onClick={() => void refresh()}>
            &gt; DEPLOY_SH
          </button>
          <div className="sidebar-status">
            <span className="pulse-indicator" />
            <span>Status: 200 OK</span>
          </div>
          <div className="session-box">
            <span style={{ fontSize: "9px" }}>UPTIME: 99.98% | REGION: US_EAST</span>
            <span title={session?.user.email ?? "Manual JWT"}>
              {session?.user.email ?? "Manual JWT"}
            </span>
            <button onClick={() => void handleSignOut()} style={{ fontSize: "10px", padding: "2px 6px" }}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN LAYOUT */}
      <main className="dashboard">
        {/* CENTER CONTENT */}
        <section className="main-content">
          <div className="bg-overlay-text">
            ANALYTIQ
            <br />
            INGESTION
            <br />
            v3.2.1
          </div>

          <header className="topbar">
            <div className="topbar-info">
              <h2>Metrics / Ingestion</h2>
              <span className="badge success">STATUS: ONLINE</span>
              <span className="badge">Cluster_01</span>
              <span className="badge">Region_US_EAST</span>
              <span className="badge">Auth_Service</span>
            </div>
            <div className="controls">
              <select value={range} onChange={(event) => setRange(event.target.value as RangeKey)}>
                <option value="24h">24 hours</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
              </select>
              <input
                value={eventName}
                onChange={(event) => setEventName(event.target.value)}
                placeholder="grep event..."
              />
              <button onClick={() => void refresh()} disabled={loading} className="mono">
                {loading ? "LOAD..." : "REFRESH"}
              </button>
            </div>
          </header>

          {error ? <p className="error">{error}</p> : null}

          {/* Metric Panels */}
          <div className="metrics-row" id="overview">
            <MetricCard
              label="API Requests"
              value={formatCount(overview.totalEvents)}
              delta={{ val: "12.4%", isUp: true }}
              points={sparklineData.requests}
              status="ok"
            />
            <MetricCard
              label="Error Rate"
              value="0.01%"
              delta={{ val: "0.2%", isUp: false }}
              points={sparklineData.errors}
              status="ok"
            />
            <MetricCard
              label="Avg Response Time"
              value={`${(dbRead + dbWrite).toFixed(2)}ms`}
              delta={{ val: "1.4%", isUp: false }}
              points={sparklineData.latency}
              status="ok"
            />
            <MetricCard
              label="Active Sessions"
              value={formatCount(overview.uniqueSessions)}
              delta={{ val: "4.8%", isUp: true }}
              points={sparklineData.sessions}
              status="ok"
            />
          </div>

          {/* Main Central Telemetry Chart */}
          <div className="dashboard-grid">
            <section className="terminal-card wide-panel" id="timeseries-chart">
              <div className="terminal-card-header">
                <span className="terminal-card-title">~/metrics/ingestion_rate.sh</span>
                <div className="terminal-card-controls">
                  <span className="terminal-card-dot" />
                  <span className="terminal-card-dot" />
                  <span className="terminal-card-dot" />
                </div>
              </div>
              <div className="terminal-card-body">
                <div className="chart-readouts">
                  <div className="readout-item">
                    <span className="readout-label">requests/sec</span>
                    <span className="readout-value mono" style={{ color: "var(--accent-primary)" }}>
                      {calculatedReqsSec}/s
                    </span>
                  </div>
                  <div className="readout-item">
                    <span className="readout-label">db latency</span>
                    <span className="readout-value mono">{(dbRead + dbWrite).toFixed(2)}ms</span>
                  </div>
                  <div className="readout-item">
                    <span className="readout-label">throughput</span>
                    <span className="readout-value mono">{calculatedThroughput}</span>
                  </div>
                  <div className="readout-item">
                    <span className="readout-label">active workers</span>
                    <span className="readout-value mono" style={{ color: "var(--accent-secondary)" }}>
                      8 / 10
                    </span>
                  </div>
                </div>

                <div className="chart-wrapper">
                  {chartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--cartesian-grid)" vertical={false} />
                        <XAxis
                          dataKey="label"
                          minTickGap={40}
                          tickLine={false}
                          tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                        />
                        <YAxis
                          allowDecimals={false}
                          tickLine={false}
                          tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                          width={45}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Area
                          type="monotone"
                          dataKey="count"
                          stroke="var(--accent-secondary)"
                          fillOpacity={1}
                          fill="url(#colorCount)"
                          strokeWidth={1.5}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="muted" style={{ textAlign: "center", paddingTop: "100px" }}>
                      Awaiting timeseries feed.
                    </p>
                  )}
                </div>
              </div>
            </section>

            {/* Sub-panels: Top Pages and Referrers */}
            <Ranking title="Top Ingested Paths" rows={overview.topPages} />
            <Ranking title="Top Traffic Referrers" rows={overview.topReferrers} />

            {/* Socket.io Realtime Stream */}
            <section className="terminal-card">
              <div className="terminal-card-header">
                <span className="terminal-card-title">~/telemetry/live_worker_stream.log</span>
                <span className="badge success" style={{ fontSize: "9px" }}>
                  LIVE: {realtime.activeUsers} USERS
                </span>
              </div>
              <div className="terminal-card-body" style={{ padding: 0 }}>
                <div className="live-stream-list">
                  {liveEvents.length === 0 ? (
                    <p className="muted" style={{ padding: "16px" }}>
                      Awaiting incoming SDK payloads...
                    </p>
                  ) : null}
                  {liveEvents.map((event, idx) => (
                    <div className="live-stream-row" key={`${event.time}-${event.sessionId}-${idx}`}>
                      <span className="event-badge">{event.eventName}</span>
                      <span className="event-url" title={event.url}>
                        {event.url ?? "/index"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Funnels Configuration */}
            <FunnelsPanel
              token={accessToken}
              funnels={funnels}
              onFunnel={(funnel) => {
                setFunnels((current) => [funnel, ...current]);
              }}
            />

            {/* Domains Settings whitelist */}
            <div id="tenant">
              {tenant ? (
                <DomainsEditor token={accessToken} tenant={tenant} onTenant={setTenant} />
              ) : null}
            </div>

            {/* Event logs table */}
            <div id="events" className="wide-panel">
              <EventTable events={events} />
            </div>
          </div>

          {/* Live Syslog Panel at the bottom */}
          <div className="syslog-panel terminal-card" id="syslog-panel">
            <div className="syslog-header">
              <span>tail -f /var/log/syslog</span>
              <span style={{ opacity: 0.6 }}>SYS_OK</span>
            </div>
            <div className="syslog-console" ref={syslogConsoleRef}>
              {syslogs.map((log, index) => (
                <div key={index} className="syslog-line">
                  <span className="syslog-ts">[{log.ts}]</span>
                  <span className={`syslog-tag ${log.level.toLowerCase()}`}>{log.level}</span>
                  <span>{log.msg}</span>
                </div>
              ))}
              <div>
                user@analytiq:~$&nbsp;
                <span className="syslog-cursor" />
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT SIDEBAR diagnostics */}
        <aside className="right-sidebar">
          <div className="infra-panel terminal-card">
            <div className="terminal-card-header">
              <span className="terminal-card-title">db_health_check.log</span>
            </div>
            <div className="terminal-card-body">
              <div className="infra-metric">
                <span className="infra-label">cluster_read</span>
                <span className="infra-val mono" style={{ color: "var(--accent-primary)" }}>
                  {dbRead.toFixed(2)}ms
                </span>
              </div>
              <div className="infra-metric">
                <span className="infra-label">cluster_write</span>
                <span className="infra-val mono" style={{ color: "var(--accent-primary)" }}>
                  {dbWrite.toFixed(2)}ms
                </span>
              </div>
              <div className="infra-metric">
                <span className="infra-label">active_connections</span>
                <span className="infra-val mono">{activeConns.toLocaleString()}</span>
              </div>
              <div className="infra-metric">
                <span className="infra-label">error_rate</span>
                <span className="infra-val mono" style={{ color: "var(--accent-primary)" }}>
                  0.01%
                </span>
              </div>
            </div>
          </div>

          <div className="infra-panel terminal-card">
            <div className="terminal-card-header">
              <span className="terminal-card-title">hardware_telemetry.log</span>
            </div>
            <div className="terminal-card-body">
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "11px",
                      fontFamily: "var(--font-mono)",
                      marginBottom: "4px"
                    }}
                  >
                    <span>CPU LOAD</span>
                    <span>{cpu}%</span>
                  </div>
                  {renderActiveBar(cpu)}
                </div>

                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "11px",
                      fontFamily: "var(--font-mono)",
                      marginBottom: "4px"
                    }}
                  >
                    <span>MEM UTILIZATION</span>
                    <span>{memory}%</span>
                  </div>
                  {renderActiveBar(memory)}
                </div>

                <div className="infra-metric" style={{ borderBottom: 0, paddingBottom: 0, marginTop: "4px" }}>
                  <span className="infra-label">queue_size</span>
                  <span className="infra-val mono" style={{ color: cpu > 85 ? "var(--warning)" : "var(--text-primary)" }}>
                    {queueSize} jobs
                  </span>
                </div>
                <div className="infra-metric" style={{ borderBottom: 0, paddingBottom: 0, paddingTop: 0 }}>
                  <span className="infra-label">worker_health</span>
                  <span className="infra-val mono" style={{ color: "var(--accent-primary)" }}>
                    ACTIVE (10/10)
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="infra-panel terminal-card">
            <div className="terminal-card-header">
              <span className="terminal-card-title">banner.txt</span>
            </div>
            <div className="terminal-card-body" style={{ padding: "8px 0" }}>
              <div className="ascii-logo">
                {` █████╗ ███╗   ██╗ █████╗ ██╗  ██╗   ██╗████████╗██╗ ██████╗
██╔══██╗████╗  ██║██╔══██╗██║  ╚██╗ ██╔╝╚══██╔══╝██║██╔═══██╗
███████║██╔██╗ ██║███████║██║   ╚████╔╝    ██║   ██║██║   ██║
██╔══██║██║╚██╗██║██╔══██║██║    ╚██╔╝     ██║   ██║██║▄▄ ██║
██║  ██║██║ ╚████║██║  ██║███████╗██║      ██║   ██║╚██████╔╝
╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═╝   ╚═╝ ╚══▀▀═╝`}
              </div>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

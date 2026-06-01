import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { RangeKey } from "@analytiq/types";

export interface TenantRecord {
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

export interface FunnelRecord {
  id: string;
  name: string;
  steps: FunnelStep[];
  createdAt: string;
}

function rangeStart(range: RangeKey): Date {
  const now = Date.now();

  switch (range) {
    case "24h":
      return new Date(now - 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now - 30 * 24 * 60 * 60 * 1000);
  }
}

function rangeBucket(range: RangeKey): "hour" | "day" {
  return range === "24h" ? "hour" : "day";
}

function toInteger(value: unknown): number {
  return Number.parseInt(String(value), 10);
}

async function withTenantClient<T>(
  pool: Pool,
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, TRUE)", [tenantId]);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function withUserClient<T>(
  pool: Pool,
  userId: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, TRUE)", [userId]);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function mapTenant(row: {
  id: string;
  name: string;
  token: string;
  domain_whitelist: string[];
  plan: string;
}): TenantRecord {
  return {
    id: row.id,
    name: row.name,
    token: row.token,
    domainWhitelist: row.domain_whitelist,
    plan: row.plan
  };
}

export async function getTenantForUser(pool: Pool, userId: string): Promise<TenantRecord | null> {
  return withUserClient(pool, userId, async (client) => {
    const result = await client.query(
      `
        SELECT id, name, token::TEXT AS token, domain_whitelist, plan
        FROM tenants
        WHERE owner_user_id = $1
        LIMIT 1
      `,
      [userId]
    );
    const row = result.rows[0] as
      | { id: string; name: string; token: string; domain_whitelist: string[]; plan: string }
      | undefined;

    return row ? mapTenant(row) : null;
  });
}

export async function setupTenant(pool: Pool, userId: string, name: string): Promise<TenantRecord> {
  const existing = await getTenantForUser(pool, userId);

  if (existing) {
    return existing;
  }

  const tenantId = randomUUID();

  return withTenantClient(pool, tenantId, async (client) => {
    await client.query("SELECT set_config('app.user_id', $1, TRUE)", [userId]);
    const result = await client.query(
      `
        INSERT INTO tenants (id, name, owner_user_id)
        VALUES ($1, $2, $3)
        RETURNING id, name, token::TEXT AS token, domain_whitelist, plan
      `,
      [tenantId, name, userId]
    );
    return mapTenant(
      result.rows[0] as { id: string; name: string; token: string; domain_whitelist: string[]; plan: string }
    );
  });
}

export async function updateTenantDomains(pool: Pool, tenantId: string, domains: string[]): Promise<TenantRecord> {
  return withTenantClient(pool, tenantId, async (client) => {
    const result = await client.query(
      `
        UPDATE tenants
        SET domain_whitelist = $2
        WHERE id = $1
        RETURNING id, name, token::TEXT AS token, domain_whitelist, plan
      `,
      [tenantId, domains]
    );
    return mapTenant(
      result.rows[0] as { id: string; name: string; token: string; domain_whitelist: string[]; plan: string }
    );
  });
}

export async function getOverviewStats(pool: Pool, tenantId: string, range: RangeKey): Promise<OverviewStats> {
  const start = rangeStart(range);

  return withTenantClient(pool, tenantId, async (client) => {
    const [summary, pages, referrers] = await Promise.all([
      client.query(
        `
          SELECT COUNT(*)::TEXT AS total_events, COUNT(DISTINCT session_id)::TEXT AS unique_sessions
          FROM events
          WHERE tenant_id = $1 AND time >= $2
        `,
        [tenantId, start]
      ),
      client.query(
        `
          SELECT url AS value, COUNT(*)::TEXT AS count
          FROM events
          WHERE tenant_id = $1 AND time >= $2 AND url IS NOT NULL
          GROUP BY url
          ORDER BY COUNT(*) DESC
          LIMIT 10
        `,
        [tenantId, start]
      ),
      client.query(
        `
          SELECT referrer AS value, COUNT(*)::TEXT AS count
          FROM events
          WHERE tenant_id = $1 AND time >= $2 AND referrer IS NOT NULL
          GROUP BY referrer
          ORDER BY COUNT(*) DESC
          LIMIT 10
        `,
        [tenantId, start]
      )
    ]);
    const summaryRow = summary.rows[0] as { total_events: string; unique_sessions: string };

    return {
      totalEvents: toInteger(summaryRow.total_events),
      uniqueSessions: toInteger(summaryRow.unique_sessions),
      topPages: pages.rows.map((row) => ({
        value: (row as { value: string }).value,
        count: toInteger((row as { count: string }).count)
      })),
      topReferrers: referrers.rows.map((row) => ({
        value: (row as { value: string }).value,
        count: toInteger((row as { count: string }).count)
      }))
    };
  });
}

export async function getTimeseries(
  pool: Pool,
  tenantId: string,
  range: RangeKey,
  eventName: string | undefined
): Promise<TimeseriesPoint[]> {
  const start = rangeStart(range);
  const bucket = rangeBucket(range);
  const values: unknown[] = [tenantId, start, bucket];
  const eventFilter = eventName ? "AND event_name = $4" : "";

  if (eventName) {
    values.push(eventName);
  }

  return withTenantClient(pool, tenantId, async (client) => {
    const result = await client.query(
      `
        SELECT date_trunc($3, time) AS bucket, COUNT(*)::TEXT AS count
        FROM events
        WHERE tenant_id = $1 AND time >= $2 ${eventFilter}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      values
    );

    return result.rows.map((row) => ({
      bucket: (row as { bucket: Date }).bucket.toISOString(),
      count: toInteger((row as { count: string }).count)
    }));
  });
}

export async function getRealtimeStats(pool: Pool, tenantId: string): Promise<RealtimeStats> {
  const last30Minutes = new Date(Date.now() - 30 * 60 * 1000);
  const activeWindow = new Date(Date.now() - 5 * 60 * 1000);

  return withTenantClient(pool, tenantId, async (client) => {
    const result = await client.query(
      `
        SELECT
          COUNT(*)::TEXT AS events_last_30_minutes,
          COUNT(DISTINCT session_id) FILTER (WHERE time >= $3)::TEXT AS active_users
        FROM events
        WHERE tenant_id = $1 AND time >= $2
      `,
      [tenantId, last30Minutes, activeWindow]
    );
    const row = result.rows[0] as { events_last_30_minutes: string; active_users: string };

    return {
      activeUsers: toInteger(row.active_users),
      eventsLast30Minutes: toInteger(row.events_last_30_minutes)
    };
  });
}

export async function getEventLog(
  pool: Pool,
  tenantId: string,
  limit: number,
  offset: number
): Promise<EventLogRow[]> {
  return withTenantClient(pool, tenantId, async (client) => {
    const result = await client.query(
      `
        SELECT
          time,
          event_name,
          properties,
          session_id::TEXT AS session_id,
          url,
          referrer,
          country,
          device,
          os,
          browser
        FROM events
        WHERE tenant_id = $1
        ORDER BY time DESC
        LIMIT $2 OFFSET $3
      `,
      [tenantId, limit, offset]
    );

    return result.rows.map((row) => {
      const event = row as {
        time: Date;
        event_name: string;
        properties: Record<string, unknown>;
        session_id: string;
        url: string | null;
        referrer: string | null;
        country: string | null;
        device: string | null;
        os: string | null;
        browser: string | null;
      };

      return {
        time: event.time.toISOString(),
        eventName: event.event_name,
        properties: event.properties,
        sessionId: event.session_id,
        url: event.url,
        referrer: event.referrer,
        country: event.country,
        device: event.device,
        os: event.os,
        browser: event.browser
      };
    });
  });
}

export async function listFunnels(pool: Pool, tenantId: string): Promise<FunnelRecord[]> {
  return withTenantClient(pool, tenantId, async (client) => {
    const result = await client.query(
      `
        SELECT id::TEXT AS id, name, steps, created_at
        FROM funnels
        WHERE tenant_id = $1
        ORDER BY created_at DESC
      `,
      [tenantId]
    );

    return result.rows.map((row) => {
      const funnel = row as { id: string; name: string; steps: FunnelStep[] | string; created_at: Date };
      const steps = typeof funnel.steps === "string" ? (JSON.parse(funnel.steps) as FunnelStep[]) : funnel.steps;
      return {
        id: funnel.id,
        name: funnel.name,
        steps,
        createdAt: funnel.created_at.toISOString()
      };
    });
  });
}

export async function createFunnel(
  pool: Pool,
  tenantId: string,
  name: string,
  steps: FunnelStep[]
): Promise<FunnelRecord> {
  return withTenantClient(pool, tenantId, async (client) => {
    const result = await client.query(
      `
        INSERT INTO funnels (tenant_id, name, steps)
        VALUES ($1, $2, $3)
        RETURNING id::TEXT AS id, name, steps, created_at
      `,
      [tenantId, name, JSON.stringify(steps)]
    );
    const row = result.rows[0] as { id: string; name: string; steps: FunnelStep[] | string; created_at: Date };
    const parsedSteps = typeof row.steps === "string" ? (JSON.parse(row.steps) as FunnelStep[]) : row.steps;

    return {
      id: row.id,
      name: row.name,
      steps: parsedSteps,
      createdAt: row.created_at.toISOString()
    };
  });
}

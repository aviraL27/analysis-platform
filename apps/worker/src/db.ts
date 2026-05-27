import type { Pool, PoolClient } from "pg";
import type { ProcessedEvent } from "./enrichment.js";

function groupEventsByTenant(events: ProcessedEvent[]): Map<string, ProcessedEvent[]> {
  const grouped = new Map<string, ProcessedEvent[]>();

  for (const event of events) {
    const tenantEvents = grouped.get(event.tenantId) ?? [];
    tenantEvents.push(event);
    grouped.set(event.tenantId, tenantEvents);
  }

  return grouped;
}

function buildInsert(events: ProcessedEvent[]): { sql: string; values: unknown[] } {
  const columnsPerRow = 12;
  const values: unknown[] = [];
  const placeholders = events.map((event, rowIndex) => {
    values.push(
      event.time,
      event.tenantId,
      event.eventName,
      event.properties,
      event.sessionId,
      event.url,
      event.referrer ?? null,
      event.country ?? null,
      event.device ?? null,
      event.os ?? null,
      event.browser ?? null,
      event.ipHash ?? null
    );

    const offset = rowIndex * columnsPerRow;
    const rowPlaceholders = Array.from({ length: columnsPerRow }, (_value, columnIndex) => {
      return `$${offset + columnIndex + 1}`;
    });

    return `(${rowPlaceholders.join(", ")})`;
  });

  return {
    sql: `
      INSERT INTO events (
        time,
        tenant_id,
        event_name,
        properties,
        session_id,
        url,
        referrer,
        country,
        device,
        os,
        browser,
        ip_hash
      )
      VALUES ${placeholders.join(", ")}
    `,
    values
  };
}

async function insertTenantEvents(client: PoolClient, tenantId: string, events: ProcessedEvent[]): Promise<void> {
  await client.query("SELECT set_config('app.tenant_id', $1, TRUE)", [tenantId]);
  const insert = buildInsert(events);
  await client.query(insert.sql, insert.values);
}

export async function insertEvents(pool: Pool, events: ProcessedEvent[]): Promise<void> {
  if (events.length === 0) {
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const [tenantId, tenantEvents] of groupEventsByTenant(events)) {
      await insertTenantEvents(client, tenantId, tenantEvents);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

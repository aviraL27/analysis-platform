# Analytiq

Analytiq is a self-hostable analytics platform: a small browser SDK sends events to an ingestion API, Redis/BullMQ buffers the write path, workers enrich and persist events into TimescaleDB, and a dashboard API/frontend will expose realtime and historical analytics per tenant.

## Architecture

```mermaid
flowchart LR
  Site[Customer Website] --> SDK[Analytiq JS SDK]
  SDK -->|POST /ingest| Ingest[Ingestion API]
  Ingest -->|validate token cache| Redis[(Redis)]
  Ingest -->|cache miss lookup| DB[(TimescaleDB / PostgreSQL)]
  Ingest -->|enqueue event| Queue[BullMQ events queue]
  Queue --> Worker[Worker]
  Worker -->|bulk insert batches| DB
  Worker -->|worker:event| DashboardAPI[Dashboard API + Socket.io]
  DashboardAPI -->|REST stats| Frontend[React Dashboard]
  DashboardAPI -->|tenant room updates| Frontend
```

## Event Ingestion Flow

```mermaid
sequenceDiagram
  participant Browser as Customer Browser
  participant Ingest as Ingestion API
  participant Redis as Redis
  participant Postgres as TimescaleDB
  participant Queue as BullMQ

  Browser->>Ingest: POST /ingest
  Ingest->>Ingest: Zod validate payload
  Ingest->>Redis: Lookup tenant by token
  alt Cache miss
    Ingest->>Postgres: SELECT tenant by token
    Postgres-->>Ingest: tenant
    Ingest->>Redis: Cache tenant for 5 minutes
  end
  Ingest->>Ingest: Check domain whitelist
  Ingest->>Redis: Sliding-window rate limit
  Ingest->>Queue: Add event job
  Ingest-->>Browser: 200 OK
```

## Worker Flow

```mermaid
flowchart TD
  Queue[BullMQ events queue] --> Worker[Worker consumer]
  Worker --> Validate[Validate job with Zod]
  Validate --> Batch[Collect batch up to 50]
  Batch --> Enrich[Parse user-agent and anonymize IP]
  Enrich --> Group[Group by tenant]
  Group --> RLS[Set app.tenant_id]
  RLS --> Insert[Bulk INSERT into events hypertable]
  Insert --> Realtime[Emit worker:event to dashboard API]
```

## Database Shape

```mermaid
erDiagram
  tenants ||--o{ events : owns
  tenants ||--o{ hourly_stats : aggregates
  tenants ||--o{ sessions : owns

  tenants {
    uuid id PK
    text name
    uuid token UK
    text_array domain_whitelist
    text plan
    timestamptz created_at
  }

  events {
    timestamptz time
    uuid tenant_id FK
    text event_name
    jsonb properties
    uuid session_id
    text url
    text referrer
    text country
    text device
    text os
    text browser
    text ip_hash
  }

  hourly_stats {
    uuid tenant_id FK
    timestamptz hour
    text event_name
    int count
  }

  sessions {
    uuid id PK
    uuid tenant_id FK
    timestamptz started_at
    timestamptz ended_at
    int page_count
    text country
    text device
  }
```

## Repository Layout

```text
apps/
  ingestion-api/    Express API that receives and queues events
  dashboard-api/    Stats/auth/realtime API
  worker/           BullMQ consumer that writes batches to TimescaleDB
  frontend/         React dashboard
  sdk/              Browser SDK
packages/
  db/               PostgreSQL client helpers and migrations
  types/            Shared TypeScript contracts
```

## Requirements

- Node.js 20+
- npm 10+
- Redis
- PostgreSQL with TimescaleDB extension available

Local services are Redis on `localhost:6379` and Postgres/TimescaleDB with a database named `analytiq`.

## Environment

Create a local `.env` file before running services:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/analytiq
DATABASE_POOL_MAX=10
DATABASE_SSL=false
REDIS_URL=redis://localhost:6379
EVENTS_QUEUE_NAME=events

INGESTION_API_PORT=3001
TENANT_CACHE_TTL_SECONDS=300
INGEST_RATE_LIMIT_MAX=1000
INGEST_RATE_LIMIT_WINDOW_SECONDS=60

WORKER_BATCH_SIZE=50
WORKER_BATCH_FLUSH_INTERVAL_MS=1000
WORKER_CONCURRENCY=10
DASHBOARD_REALTIME_URL=http://localhost:3002
```

## Install

```bash
npm install
```

## Database Migration

Run migrations after PostgreSQL/TimescaleDB is available:

```bash
npm run migrate --workspace @analytiq/db
```

The first migration enables `timescaledb` and `pgcrypto`, creates the schema, converts `events` to a hypertable, creates indexes, and enables RLS policies.

## Development

Run everything:

```bash
npm run dev
```

Run a single workspace:

```bash
npm run dev --workspace @analytiq/ingestion-api
npm run dev --workspace @analytiq/worker
```

Build and typecheck:

```bash
npm run build
npm run typecheck
```

Security audit:

```bash
npm audit --omit dev
```

## Ingest API

Endpoint:

```http
POST /ingest
Content-Type: application/json
```

Example payload:

```json
{
  "token": "00000000-0000-0000-0000-000000000000",
  "eventName": "pageview",
  "properties": {
    "path": "/pricing"
  },
  "sessionId": "11111111-1111-1111-1111-111111111111",
  "url": "https://example.com/pricing",
  "referrer": "https://google.com",
  "occurredAt": "2026-05-27T10:00:00.000Z",
  "userAgent": "Mozilla/5.0"
}
```

The ingestion API validates payloads, checks tenant token/domain/rate limit, enqueues the event, and returns quickly. It never writes events directly to the database.

## Security Model

- Zod validation on ingestion and worker queue payloads
- Helmet on ingestion API
- Redis token cache
- Redis sliding-window rate limit
- Domain whitelist checks
- Parameterized SQL
- RLS enabled on project tables
- IP anonymization before event storage
- Supabase JWT verification middleware
- Tenant ID derived from authenticated user context
- Tenant-scoped queries on every route
- Socket.io tenant rooms

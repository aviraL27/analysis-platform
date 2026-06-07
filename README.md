# Analytiq

Analytiq is a self-hostable analytics platform: a small browser SDK sends events to an ingestion API, Redis/BullMQ buffers the write path, workers enrich and persist events into TimescaleDB, and a dashboard API/frontend expose realtime and historical analytics per tenant.

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
    uuid owner_user_id UK
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
DASHBOARD_WORKER_TOKEN=replace-with-a-long-random-secret

DASHBOARD_API_PORT=3002
SUPABASE_URL=
SUPABASE_JWT_SECRET=
FRONTEND_ORIGIN=http://localhost:5173

VITE_DASHBOARD_API_URL=http://localhost:3002
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
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

The migrations enable `timescaledb` and `pgcrypto`, create the schema, convert `events` to a hypertable, create indexes, enable RLS policies, and add a Supabase user-to-tenant owner mapping.

## Development

Run everything:

```bash
npm run dev
```

Run a single workspace:

```bash
npm run dev --workspace @analytiq/ingestion-api
npm run dev --workspace @analytiq/dashboard-api
npm run dev --workspace @analytiq/worker
npm run dev --workspace @analytiq/frontend
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

## Browser SDK

Build the installable SDK package:

```bash
npm run build --workspace @analytiq/sdk
```

During local development, install it in another project using the path to this
repository's SDK directory. From this machine, that command is:

```bash
npm install "D:/Coding/analytics project/apps/sdk"
```

In a React/Vite application, put the initialization in the browser entry file
(`src/main.tsx`, `src/main.jsx`, `src/index.tsx`, or equivalent), before the app
is rendered:

```ts
import { init } from "@analytiq/sdk";

init({
  token: "00000000-0000-0000-0000-000000000000",
  endpoint: "http://localhost:3001/ingest"
});
```

That `init(...)` call is the one line that starts tracking. It sends an
automatic `pageview` and enables automatic click tracking by default. Import
and call `track` anywhere after initialization for custom events:

```ts
import { track } from "@analytiq/sdk";

track("signup", { properties: { plan: "pro" } });
```

For a plain HTML project, the ingestion API serves the built browser bundle at
`/sdk`. Put these scripts near the end of `<body>`, before `</body>`:

```html
<script src="http://localhost:3001/sdk"></script>
<script>
  analytiq.init({
    token: "00000000-0000-0000-0000-000000000000",
    endpoint: "http://localhost:3001/ingest"
  });
</script>
```

The tracked project's hostname must be included in the tenant's domain
whitelist. An empty whitelist allows every hostname.

## Dashboard

The dashboard API verifies Supabase JWTs, maps the authenticated user to a tenant, and serves tenant-scoped stats. The React dashboard supports Supabase Auth when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set, and also includes a manual JWT field for local development.

Socket.io dashboard clients authenticate with their Supabase JWT. Worker realtime events authenticate separately with `DASHBOARD_WORKER_TOKEN`; without that token the worker falls back to no-op realtime emission.

Key API routes:

```http
GET /tenant
POST /tenants/setup
PUT /tenants/domains
GET /stats/overview?range=24h|7d|30d
GET /stats/timeseries?range=7d&event=pageview
GET /stats/realtime
GET /events?limit=50&offset=0
GET /funnels
```

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
- Supabase JWT audience validation for dashboard clients
- Tenant ID derived from authenticated user context
- Tenant-scoped queries on every route
- Socket.io tenant rooms with authenticated dashboard clients
- Worker Socket.io events protected by `DASHBOARD_WORKER_TOKEN`
- Dependency-free browser SDK with pageview, click, and custom event capture

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  domain_whitelist TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  time TIMESTAMPTZ NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}'::JSONB,
  session_id UUID NOT NULL,
  url TEXT,
  referrer TEXT,
  country TEXT,
  device TEXT,
  os TEXT,
  browser TEXT,
  ip_hash TEXT
);

SELECT create_hypertable('events', 'time', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS hourly_stats (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hour TIMESTAMPTZ NOT NULL,
  event_name TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, hour, event_name)
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0,
  country TEXT,
  device TEXT
);

CREATE INDEX IF NOT EXISTS tenants_token_idx ON tenants (token);
CREATE INDEX IF NOT EXISTS events_tenant_time_idx ON events (tenant_id, time DESC);
CREATE INDEX IF NOT EXISTS events_tenant_event_time_idx ON events (tenant_id, event_name, time DESC);
CREATE INDEX IF NOT EXISTS events_tenant_session_time_idx ON events (tenant_id, session_id, time DESC);
CREATE INDEX IF NOT EXISTS events_tenant_url_time_idx ON events (tenant_id, url, time DESC);
CREATE INDEX IF NOT EXISTS hourly_stats_tenant_hour_idx ON hourly_stats (tenant_id, hour DESC);
CREATE INDEX IF NOT EXISTS sessions_tenant_started_idx ON sessions (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS sessions_tenant_ended_idx ON sessions (tenant_id, ended_at DESC);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hourly_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
ALTER TABLE hourly_stats FORCE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_tenant_isolation ON tenants;
CREATE POLICY tenants_tenant_isolation ON tenants
  USING (id = NULLIF(current_setting('app.tenant_id', TRUE), '')::UUID)
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS events_tenant_isolation ON events;
CREATE POLICY events_tenant_isolation ON events
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS hourly_stats_tenant_isolation ON hourly_stats;
CREATE POLICY hourly_stats_tenant_isolation ON hourly_stats
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS sessions_tenant_isolation ON sessions;
CREATE POLICY sessions_tenant_isolation ON sessions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::UUID);

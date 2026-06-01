CREATE TABLE IF NOT EXISTS funnels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  steps JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS funnels_tenant_created_idx ON funnels (tenant_id, created_at DESC);

ALTER TABLE funnels ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnels FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS funnels_tenant_isolation ON funnels;
CREATE POLICY funnels_tenant_isolation ON funnels
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::UUID)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', TRUE), '')::UUID);

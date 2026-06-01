ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS owner_user_id UUID UNIQUE;

CREATE INDEX IF NOT EXISTS tenants_owner_user_id_idx ON tenants (owner_user_id);

DROP POLICY IF EXISTS tenants_owner_mapping ON tenants;
CREATE POLICY tenants_owner_mapping ON tenants
  USING (owner_user_id = NULLIF(current_setting('app.user_id', TRUE), '')::UUID)
  WITH CHECK (owner_user_id = NULLIF(current_setting('app.user_id', TRUE), '')::UUID);

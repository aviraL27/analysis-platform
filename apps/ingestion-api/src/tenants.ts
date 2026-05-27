import type { CachedTenant } from "@analytiq/types";
import type { Pool } from "pg";
import type IORedis from "ioredis";

interface TenantRow {
  id: string;
  token: string;
  domain_whitelist: string[];
  plan: string;
}

function tenantCacheKey(token: string): string {
  return `tenant:token:${token}`;
}

function parseCachedTenant(value: string): CachedTenant | null {
  try {
    const parsed = JSON.parse(value) as Partial<CachedTenant>;

    if (
      typeof parsed.id !== "string" ||
      typeof parsed.token !== "string" ||
      !Array.isArray(parsed.domainWhitelist) ||
      typeof parsed.plan !== "string"
    ) {
      return null;
    }

    return {
      id: parsed.id,
      token: parsed.token,
      domainWhitelist: parsed.domainWhitelist.filter((domain): domain is string => typeof domain === "string"),
      plan: parsed.plan
    };
  } catch {
    return null;
  }
}

export async function getTenantByToken(
  redis: IORedis,
  pool: Pool,
  token: string,
  cacheTtlSeconds: number
): Promise<CachedTenant | null> {
  const cacheKey = tenantCacheKey(token);
  const cached = await redis.get(cacheKey);

  if (cached) {
    const tenant = parseCachedTenant(cached);

    if (tenant) {
      return tenant;
    }
  }

  const result = await pool.query<TenantRow>(
    "SELECT id, token, domain_whitelist, plan FROM tenants WHERE token = $1",
    [token]
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  const tenant: CachedTenant = {
    id: row.id,
    token: row.token,
    domainWhitelist: row.domain_whitelist,
    plan: row.plan
  };

  await redis.set(cacheKey, JSON.stringify(tenant), "EX", cacheTtlSeconds);

  return tenant;
}

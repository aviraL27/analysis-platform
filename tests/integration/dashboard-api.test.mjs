import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

const apiBaseUrl = process.env.DASHBOARD_API_URL ?? "http://localhost:3002";
const ingestionBaseUrl = process.env.INGESTION_API_URL ?? "http://localhost:3001";
const jwt = process.env.TEST_JWT;

if (!jwt) {
  throw new Error("TEST_JWT is required for integration tests");
}

async function request(path, { method = "GET", body } = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${jwt}`
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function ingestEvent(token) {
  const payload = {
    token,
    eventName: "pageview",
    properties: { source: "integration-test" },
    sessionId: randomUUID(),
    url: "http://localhost:5173",
    referrer: "http://localhost:5173",
    occurredAt: new Date().toISOString()
  };

  const response = await fetch(`${ingestionBaseUrl}/ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  assert.equal(response.status, 200, "ingestion endpoint should accept event");
}

test("dashboard API integration flow", async () => {
  const tenantName = `Integration ${new Date().toISOString()}`;

  const tenantResponse = await request("/tenant");
  let tenant = tenantResponse.payload.tenant;

  if (tenantResponse.response.status === 404) {
    const setup = await request("/tenants/setup", { method: "POST", body: { name: tenantName } });
    assert.equal(setup.response.status, 200, "tenant setup should succeed");
    tenant = setup.payload.tenant;
  }

  assert.ok(tenant?.token, "tenant token should be available");

  const domains = await request("/tenants/domains", {
    method: "PUT",
    body: { domains: ["localhost"] }
  });
  assert.equal(domains.response.status, 200, "domain update should succeed");

  const funnelName = `Signup ${randomUUID().slice(0, 8)}`;
  const funnelCreate = await request("/funnels", {
    method: "POST",
    body: {
      name: funnelName,
      steps: [{ event: "pageview" }, { event: "signup" }, { event: "purchase" }]
    }
  });
  assert.equal(funnelCreate.response.status, 200, "funnel create should succeed");

  const funnelList = await request("/funnels");
  assert.equal(funnelList.response.status, 200, "funnel list should succeed");
  assert.ok(
    funnelList.payload.funnels?.some((funnel) => funnel.name === funnelName),
    "funnel list should include created funnel"
  );

  await ingestEvent(tenant.token);

  let eventsSeen = false;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const overview = await request("/stats/overview?range=24h");
    assert.equal(overview.response.status, 200, "overview should succeed");

    if ((overview.payload.totalEvents ?? 0) > 0) {
      eventsSeen = true;
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  assert.ok(eventsSeen, "overview should eventually show ingested events");
});

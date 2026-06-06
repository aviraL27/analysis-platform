import { randomUUID } from "node:crypto";

const tokens = [
  "51100e24-d3c2-49b1-be92-925493587d37",
  "47d9b1a6-e97b-4462-b27c-f93ffffe35d9",
  "49c66f03-4c36-497c-aee7-615f5f7a48bf",
  "31880d74-03b3-4183-b2e0-1b31e2db35f1"
];

for (const token of tokens) {
  console.log(`Sending events for token: ${token}`);
  
  const sessionId = randomUUID();
  const payload1 = {
    token,
    eventName: "pageview",
    properties: { path: "/home", source: "automated-test" },
    sessionId,
    url: "http://localhost:8080/test.html",
    referrer: "http://google.com",
    occurredAt: new Date().toISOString()
  };

  const payload2 = {
    token,
    eventName: "click",
    properties: { tag: "button", text: "Trigger Signup Action", source: "automated-test" },
    sessionId,
    url: "http://localhost:8080/test.html",
    referrer: "http://google.com",
    occurredAt: new Date().toISOString()
  };

  const payload3 = {
    token,
    eventName: "signup",
    properties: { plan: "pro", source: "automated-test" },
    sessionId,
    url: "http://localhost:8080/test.html",
    referrer: "http://google.com",
    occurredAt: new Date().toISOString()
  };

  for (const payload of [payload1, payload2, payload3]) {
    try {
      const response = await fetch("http://localhost:3001/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      console.log(`- Sent ${payload.eventName}: Response ${response.status}`);
      if (response.status !== 200) {
        const text = await response.text();
        console.log(`  Detail: ${text}`);
      }
    } catch (err) {
      console.error(`- Failed to send ${payload.eventName}:`, err.message);
    }
  }
}

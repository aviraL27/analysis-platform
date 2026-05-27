import { createDatabasePool } from "@analytiq/db";
import { getConfig } from "./config.js";
import { createEventsQueue } from "./queue.js";
import { createRedisConnection } from "./redis.js";
import { createServer } from "./server.js";

const config = getConfig();
const redis = createRedisConnection(config.redisUrl);
const pool = createDatabasePool({
  connectionString: config.databaseUrl
});

await redis.connect();

const queue = createEventsQueue(config.queueName, config.redisUrl);
const app = createServer({ config, redis, pool, queue });

const server = app.listen(config.port, () => {
  console.log(`Ingestion API listening on port ${config.port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await queue.close();
  await redis.quit();
  await pool.end();
}

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

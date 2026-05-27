import { createDatabasePool } from "@analytiq/db";
import { EventBatcher } from "./batcher.js";
import { getConfig } from "./config.js";
import { createRealtimeClient } from "./realtime.js";
import { createEventsWorker } from "./worker.js";

const config = getConfig();
const pool = createDatabasePool({
  connectionString: config.databaseUrl
});
const realtime = createRealtimeClient(config.realtimeServerUrl);
const batcher = new EventBatcher({
  batchSize: config.batchSize,
  flushIntervalMs: config.batchFlushIntervalMs,
  pool,
  realtime
});
const worker = createEventsWorker(config.queueName, config.redisUrl, config.workerConcurrency, batcher);

worker.on("ready", () => {
  console.log(`Worker listening on queue "${config.queueName}"`);
});

worker.on("failed", (job, error) => {
  console.error(`Job ${job?.id ?? "unknown"} failed`, error);
});

worker.on("error", (error) => {
  console.error("Worker error", error);
});

async function shutdown(): Promise<void> {
  await worker.close();
  await batcher.close();
  realtime.close();
  await pool.end();
}

process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

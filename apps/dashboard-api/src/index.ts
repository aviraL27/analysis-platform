import { createServer as createHttpServer } from "node:http";
import { createDatabasePool } from "@analytiq/db";
import { getConfig } from "./config.js";
import { createRealtimeServer } from "./realtime.js";
import { createServer } from "./server.js";

const config = getConfig();
const pool = createDatabasePool();
const app = createServer({ config, pool });
const httpServer = createHttpServer(app);
const io = createRealtimeServer(httpServer, config, pool);

httpServer.listen(config.port, () => {
  console.log(`Dashboard API listening on port ${config.port}`);
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}, shutting down dashboard API`);
  io.close();
  httpServer.close(() => {
    void pool.end().then(() => {
      process.exit(0);
    });
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

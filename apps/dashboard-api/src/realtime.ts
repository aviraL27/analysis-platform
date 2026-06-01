import type { Server as HttpServer } from "node:http";
import type { Server as IOServer, Socket } from "socket.io";
import { Server } from "socket.io";
import type { Pool } from "pg";
import { verifySupabaseJwt } from "./auth.js";
import type { DashboardConfig } from "./config.js";
import { getTenantForUser } from "./db.js";

interface WorkerEventPayload {
  room: string;
  event: unknown;
}

function isWorkerEventPayload(payload: unknown): payload is WorkerEventPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as { room?: unknown; event?: unknown };
  return typeof candidate.room === "string" && /^tenant:[0-9a-f-]{36}$/i.test(candidate.room);
}

export function createRealtimeServer(httpServer: HttpServer, config: DashboardConfig, pool: Pool): IOServer {
  const io = new Server(httpServer, {
    cors: {
      origin: config.frontendOrigin,
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    try {
      const workerToken = socket.handshake.auth.workerToken;

      if (
        config.workerRealtimeToken &&
        typeof workerToken === "string" &&
        workerToken === config.workerRealtimeToken
      ) {
        socket.data.isWorker = true;
        next();
        return;
      }

      const token = socket.handshake.auth.token;

      if (typeof token !== "string") {
        next(new Error("Missing socket token"));
        return;
      }

      const auth = await verifySupabaseJwt(token, config);
      const tenant = await getTenantForUser(pool, auth.userId);

      if (tenant) {
        socket.data.tenantId = tenant.id;
      }

      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error("Invalid socket token"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const tenantId = socket.data.tenantId;

    if (typeof tenantId === "string") {
      void socket.join(`tenant:${tenantId}`);
    }

    socket.on("worker:event", (payload: WorkerEventPayload) => {
      if (socket.data.isWorker !== true || !isWorkerEventPayload(payload)) {
        return;
      }

      io.to(payload.room).emit("event", payload.event);
    });
  });

  return io;
}

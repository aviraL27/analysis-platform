import { io, type Socket } from "socket.io-client";
import type { ProcessedEvent } from "./enrichment.js";

export interface RealtimeClient {
  emitEvents(events: ProcessedEvent[]): void;
  close(): void;
}

class SocketRealtimeClient implements RealtimeClient {
  readonly #socket: Socket;
  readonly #serverUrl: string;

  constructor(serverUrl: string, workerToken: string) {
    this.#serverUrl = serverUrl;
    this.#socket = io(serverUrl, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      auth: {
        workerToken
      }
    });

    this.#socket.on("connect", () => {
      console.log(`[realtime] Connected to dashboard-api Socket.io at ${this.#serverUrl} (id=${this.#socket.id})`);
    });

    this.#socket.on("disconnect", (reason: string) => {
      console.warn(`[realtime] Disconnected from dashboard-api: ${reason}`);
    });

    this.#socket.on("connect_error", (err: Error) => {
      console.error(`[realtime] Connection error to ${this.#serverUrl}: ${err.message}`);
    });
  }

  emitEvents(events: ProcessedEvent[]): void {
    if (!this.#socket.connected) {
      console.warn(`[realtime] Socket not connected — skipping emit of ${events.length} event(s)`);
      return;
    }

    for (const event of events) {
      this.#socket.emit("worker:event", {
        room: `tenant:${event.tenantId}`,
        event: {
          time: event.time.toISOString(),
          tenantId: event.tenantId,
          eventName: event.eventName,
          url: event.url,
          referrer: event.referrer,
          sessionId: event.sessionId,
          device: event.device,
          os: event.os,
          browser: event.browser,
          properties: event.properties
        }
      });

      console.log(`[realtime] Emitted worker:event → room tenant:${event.tenantId.slice(0, 8)}… name=${event.eventName}`);
    }
  }

  close(): void {
    this.#socket.close();
  }
}

class NoopRealtimeClient implements RealtimeClient {
  emitEvents(): void {
    return;
  }

  close(): void {
    return;
  }
}

export function createRealtimeClient(
  serverUrl: string | undefined,
  workerToken: string | undefined
): RealtimeClient {
  if (!serverUrl || !workerToken) {
    console.warn("[realtime] DASHBOARD_REALTIME_URL or DASHBOARD_WORKER_TOKEN not set — realtime relay disabled");
    return new NoopRealtimeClient();
  }

  return new SocketRealtimeClient(serverUrl, workerToken);
}

import { io, type Socket } from "socket.io-client";
import type { ProcessedEvent } from "./enrichment.js";

export interface RealtimeClient {
  emitEvents(events: ProcessedEvent[]): void;
  close(): void;
}

class SocketRealtimeClient implements RealtimeClient {
  readonly #socket: Socket;

  constructor(serverUrl: string, workerToken: string) {
    this.#socket = io(serverUrl, {
      transports: ["websocket"],
      reconnection: true,
      auth: {
        workerToken
      }
    });
  }

  emitEvents(events: ProcessedEvent[]): void {
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

export function createRealtimeClient(serverUrl: string | undefined, workerToken: string | undefined): RealtimeClient {
  if (!serverUrl || !workerToken) {
    return new NoopRealtimeClient();
  }

  return new SocketRealtimeClient(serverUrl, workerToken);
}

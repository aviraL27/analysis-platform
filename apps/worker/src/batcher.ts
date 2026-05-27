import type { Job } from "bullmq";
import type { EventQueueJob } from "@analytiq/types";
import type { Pool } from "pg";
import type { RealtimeClient } from "./realtime.js";
import { insertEvents } from "./db.js";
import { processEvent } from "./enrichment.js";
import { parseEventQueueJob } from "./schemas.js";

interface QueuedJob {
  job: Job<EventQueueJob, void, "event">;
  resolve: () => void;
  reject: (error: unknown) => void;
}

export interface EventBatcherOptions {
  batchSize: number;
  flushIntervalMs: number;
  pool: Pool;
  realtime: RealtimeClient;
}

export class EventBatcher {
  readonly #batchSize: number;
  readonly #flushIntervalMs: number;
  readonly #pool: Pool;
  readonly #realtime: RealtimeClient;
  #queue: QueuedJob[] = [];
  #timer: NodeJS.Timeout | undefined;
  #flushChain: Promise<void> = Promise.resolve();

  constructor(options: EventBatcherOptions) {
    this.#batchSize = options.batchSize;
    this.#flushIntervalMs = options.flushIntervalMs;
    this.#pool = options.pool;
    this.#realtime = options.realtime;
  }

  add(job: Job<EventQueueJob, void, "event">): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#queue.push({ job, resolve, reject });

      if (this.#queue.length >= this.#batchSize) {
        this.#scheduleImmediateFlush();
        return;
      }

      this.#scheduleTimedFlush();
    });
  }

  async close(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }

    await this.#flush();
    await this.#flushChain;
  }

  #scheduleTimedFlush(): void {
    if (this.#timer) {
      return;
    }

    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#scheduleImmediateFlush();
    }, this.#flushIntervalMs);
  }

  #scheduleImmediateFlush(): void {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }

    this.#flushChain = this.#flushChain.then(() => this.#flush());
  }

  async #flush(): Promise<void> {
    const queuedJobs = this.#queue.splice(0, this.#batchSize);

    if (queuedJobs.length === 0) {
      return;
    }

    try {
      const events = queuedJobs.map(({ job }) => processEvent(parseEventQueueJob(job.data)));
      await insertEvents(this.#pool, events);
      this.#realtime.emitEvents(events);

      for (const queuedJob of queuedJobs) {
        queuedJob.resolve();
      }
    } catch (error) {
      for (const queuedJob of queuedJobs) {
        queuedJob.reject(error);
      }
    }
  }
}

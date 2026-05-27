import { Worker } from "bullmq";
import type { EventQueueJob } from "@analytiq/types";
import type { EventBatcher } from "./batcher.js";

export function createEventsWorker(
  queueName: string,
  redisUrl: string,
  concurrency: number,
  batcher: EventBatcher
): Worker<EventQueueJob, void, "event"> {
  return new Worker<EventQueueJob, void, "event">(
    queueName,
    async (job) => batcher.add(job),
    {
      concurrency,
      connection: {
        url: redisUrl,
        maxRetriesPerRequest: null,
        enableReadyCheck: false
      }
    }
  );
}

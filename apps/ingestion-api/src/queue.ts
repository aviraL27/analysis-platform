import { Queue } from "bullmq";
import type { EventQueueJob } from "@analytiq/types";

export type EventsQueue = Queue<EventQueueJob, void, "event">;

export function createEventsQueue(queueName: string, redisUrl: string): EventsQueue {
  return new Queue<EventQueueJob, void, "event">(queueName, {
    connection: {
      url: redisUrl,
      maxRetriesPerRequest: null,
      enableReadyCheck: false
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000
      },
      removeOnComplete: 10_000,
      removeOnFail: 50_000
    }
  });
}

import { randomUUID } from "node:crypto";
import type IORedis from "ioredis";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

function rateLimitKey(token: string): string {
  return `rate:ingest:${token}`;
}

export async function checkRateLimit(
  redis: IORedis,
  token: string,
  maxRequests: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const key = rateLimitKey(token);
  const member = `${now}:${randomUUID()}`;

  const results = await redis
    .multi()
    .zremrangebyscore(key, 0, now - windowMs)
    .zadd(key, now, member)
    .zcard(key)
    .pexpire(key, windowMs)
    .exec();

  const countResult = results?.[2]?.[1];
  const count = typeof countResult === "number" ? countResult : maxRequests + 1;
  const allowed = count <= maxRequests;

  if (!allowed) {
    await redis.zrem(key, member);
  }

  return {
    allowed,
    remaining: Math.max(maxRequests - count, 0),
    resetAt: new Date(now + windowMs)
  };
}

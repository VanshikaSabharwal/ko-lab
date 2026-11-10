import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import type { FixSearchResult } from "./findFix";

/**
 * Shared state for "Find fix": per-user rate limit, the global monthly SearchApi
 * cap, and the search-result cache.
 *
 * This lives in Upstash Redis because Vercel runs requests on separate
 * instances — an in-memory counter would be per instance and the limits would
 * never actually hold. Without Redis env vars, production fails closed; dev
 * falls back to memory so the feature can be tried locally.
 */
export interface FixStore {
  /** Counts one Find fix click for the user. */
  limit(userId: string): Promise<{ success: boolean; remaining: number; reset: number }>;
  getCache(key: string): Promise<FixSearchResult[] | null>;
  setCache(key: string, results: FixSearchResult[]): Promise<void>;
  /** Takes one SearchApi call from this month's budget; false when the cap is reached. */
  reserveMonthly(cap: number): Promise<boolean>;
  /** Gives back a reservation whose search failed. */
  releaseMonthly(): Promise<void>;
}

const CACHE_TTL_S = 24 * 60 * 60;
const MONTH_TTL_S = 35 * 24 * 60 * 60;
const HOUR_MS = 60 * 60 * 1000;

export function hourlyLimit(): number {
  const n = Number(process.env.FIX_SEARCH_LIMIT_PER_HOUR);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export function monthlyCap(): number {
  const raw = process.env.FIX_SEARCH_MONTHLY_CAP;
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n >= 0 ? n : 90;
}

function monthKey(now = new Date()): string {
  return `fixsearch:month:${now.toISOString().slice(0, 7)}`;
}

function upstashStore(): FixStore {
  const redis = Redis.fromEnv();
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(hourlyLimit(), "1 h"),
    prefix: "fixsearch:user",
  });
  return {
    async limit(userId) {
      const r = await limiter.limit(userId);
      return { success: r.success, remaining: r.remaining, reset: r.reset };
    },
    async getCache(key) {
      return (await redis.get<FixSearchResult[]>(`fixsearch:cache:${key}`)) ?? null;
    },
    async setCache(key, results) {
      await redis.set(`fixsearch:cache:${key}`, results, { ex: CACHE_TTL_S });
    },
    async reserveMonthly(cap) {
      const key = monthKey();
      const used = await redis.incr(key);
      if (used === 1) await redis.expire(key, MONTH_TTL_S);
      if (used > cap) {
        await redis.decr(key);
        return false;
      }
      return true;
    },
    async releaseMonthly() {
      const key = monthKey();
      const left = await redis.decr(key);
      if (left < 0) await redis.set(key, 0, { ex: MONTH_TTL_S });
    },
  };
}

/** Dev-only stand-in with the same behaviour, single process. */
export function memoryStore(now: () => number = Date.now): FixStore {
  const hits = new Map<string, number[]>();
  const cache = new Map<string, { value: FixSearchResult[]; expires: number }>();
  const months = new Map<string, number>();
  return {
    async limit(userId) {
      const t = now();
      const max = hourlyLimit();
      const recent = (hits.get(userId) ?? []).filter((h) => t - h < HOUR_MS);
      if (recent.length >= max) {
        hits.set(userId, recent);
        return { success: false, remaining: 0, reset: recent[0]! + HOUR_MS };
      }
      recent.push(t);
      hits.set(userId, recent);
      return { success: true, remaining: max - recent.length, reset: recent[0]! + HOUR_MS };
    },
    async getCache(key) {
      const hit = cache.get(key);
      if (!hit) return null;
      if (hit.expires < now()) {
        cache.delete(key);
        return null;
      }
      return hit.value;
    },
    async setCache(key, value) {
      if (cache.size >= 500) cache.delete(cache.keys().next().value!);
      cache.set(key, { value, expires: now() + CACHE_TTL_S * 1000 });
    },
    async reserveMonthly(cap) {
      const key = monthKey(new Date(now()));
      const used = (months.get(key) ?? 0) + 1;
      if (used > cap) return false;
      months.set(key, used);
      return true;
    },
    async releaseMonthly() {
      const key = monthKey(new Date(now()));
      months.set(key, Math.max(0, (months.get(key) ?? 0) - 1));
    },
  };
}

let store: FixStore | null | undefined;
let devStore: FixStore | undefined;

/** The store, or null when Redis isn't configured in production. */
export function getFixStore(): FixStore | null {
  if (store !== undefined) return store;
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    store = upstashStore();
  } else if (process.env.NODE_ENV !== "production") {
    devStore ??= memoryStore();
    store = devStore;
  } else {
    store = null;
  }
  return store;
}

import "server-only";
import { log } from "@/lib/log";

type ReadResult<T> = {
  data: T[] | null;
  error: { code?: string; message: string } | null;
};

const RETRY_DELAYS_MS = [1000, 2000];

/**
 * Analytics SELECTs only. A newly issued JWT can briefly be rejected by
 * PostgREST's clock. Rebuild the same read, keeping its user-scoped client
 * and filters; never refresh tokens, retry writes, or relax JWT validation.
 * Persistent failures still reach the page's error state after two retries.
 */
export async function readAnalyticsPage<T>(read: () => PromiseLike<ReadResult<T>>): Promise<ReadResult<T>> {
  for (let attempt = 0; ; attempt += 1) {
    const result = await read();
    const futureJwt = result.error?.code === "PGRST303"
      && result.error.message === "JWT issued at future";
    if (!futureJwt) {
      if (!result.error && attempt > 0) log("info", "analytics.jwt_timing_recovered", { retries: attempt });
      return result;
    }
    if (attempt >= RETRY_DELAYS_MS.length) {
      log("error", "analytics.jwt_timing_retries_exhausted", { code: "PGRST303", retries: attempt });
      return result;
    }
    log("warn", "analytics.jwt_timing_retry", { code: "PGRST303", retry: attempt + 1 });
    await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}

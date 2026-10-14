/**
 * Retries a request that failed for a reason worth retrying (the network
 * dropped, or the server answered 5xx or 429), with growing pauses. A 4xx
 * answer is final: trying again would get the same answer.
 */
export type RetryOptions = { attempts?: number; delaysMs?: number[]; sleep?: (ms: number) => Promise<void>; onRetry?: (attempt: number) => void };

export function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}

export async function fetchWithRetry(run: () => Promise<Response>, options: RetryOptions = {}): Promise<Response> {
  const attempts = options.attempts ?? 3;
  const delays = options.delaysMs ?? [1000, 3000, 8000];
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await run();
      if (!isRetryableStatus(response.status) || attempt === attempts) return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
    }
    options.onRetry?.(attempt);
    await sleep(delays[Math.min(attempt - 1, delays.length - 1)]);
  }
  throw lastError ?? new Error("Request failed");
}

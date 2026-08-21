/**
 * Token bucket rate limiter (Section 8.2) refilling continuously.
 */
export class TokenBucket {
  private capacity: number;
  private tokens: number;
  private refillRatePerMs: number;
  private lastRefill: number;

  constructor(rpm: number) {
    this.capacity = rpm;
    this.tokens = rpm;
    this.refillRatePerMs = rpm / 60000;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRatePerMs);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    const waitMs = Math.ceil((1 - this.tokens) / this.refillRatePerMs);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return this.acquire();
  }
}

/**
 * Async Semaphore for bounding concurrent operations.
 */
export class AsyncSemaphore {
  private maxConcurrent: number;
  private current: number = 0;
  private queue: Array<() => void> = [];

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  async acquire(): Promise<() => void> {
    if (this.current < this.maxConcurrent) {
      this.current++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          this.release();
        }
      };
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        let released = false;
        resolve(() => {
          if (!released) {
            released = true;
            this.release();
          }
        });
      });
    });
  }

  private release(): void {
    this.current--;
    if (this.queue.length > 0 && this.current < this.maxConcurrent) {
      this.current++;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

// Global registry of rate limiters and semaphores per provider
const tokenBuckets = new Map<string, TokenBucket>();
const semaphores = new Map<string, AsyncSemaphore>();

export function getProviderRateLimiter(name: string, rpm: number): TokenBucket {
  let tb = tokenBuckets.get(name);
  if (!tb) {
    tb = new TokenBucket(rpm);
    tokenBuckets.set(name, tb);
  }
  return tb;
}

export function getProviderSemaphore(name: string, concurrent: number): AsyncSemaphore {
  let sem = semaphores.get(name);
  if (!sem) {
    sem = new AsyncSemaphore(concurrent);
    semaphores.set(name, sem);
  }
  return sem;
}

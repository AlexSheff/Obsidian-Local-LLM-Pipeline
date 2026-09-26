export interface RateLimiterOptions {
  maxConcurrent?: number;
  minIntervalMs?: number;
}

export class RateLimiter {
  private maxConcurrent: number;
  private minIntervalMs: number;
  private running = 0;
  private queue: Array<() => void> = [];
  private lastCallTimestamp = 0;

  constructor(options: RateLimiterOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? 1;
    this.minIntervalMs = options.minIntervalMs ?? 0;
  }

  public updateConfig(options: RateLimiterOptions): void {
    if (options.maxConcurrent !== undefined && options.maxConcurrent > 0) {
      this.maxConcurrent = options.maxConcurrent;
    }
    if (options.minIntervalMs !== undefined && options.minIntervalMs >= 0) {
      this.minIntervalMs = options.minIntervalMs;
    }
  }

  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      if (this.minIntervalMs > 0) {
        const now = Date.now();
        const elapsed = now - this.lastCallTimestamp;
        if (elapsed < this.minIntervalMs) {
          await new Promise(r => setTimeout(r, this.minIntervalMs - elapsed));
        }
      }
      this.lastCallTimestamp = Date.now();
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  private release(): void {
    this.running--;
    if (this.queue.length > 0 && this.running < this.maxConcurrent) {
      const next = this.queue.shift();
      if (next) next();
    }
  }

  public getPendingCount(): number {
    return this.queue.length;
  }

  public getRunningCount(): number {
    return this.running;
  }
}

export const sharedDecisionLimiter = new RateLimiter({ maxConcurrent: 1, minIntervalMs: 0 });

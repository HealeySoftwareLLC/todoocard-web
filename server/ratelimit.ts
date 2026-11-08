/** Tiny in-memory token bucket keyed by client IP. Good enough for a small deployment. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; updated: number }>();
  constructor(
    private capacity: number,
    private refillPerSec: number,
  ) {}

  take(key: string): boolean {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, updated: now };
      this.buckets.set(key, b);
    }
    const elapsed = (now - b.updated) / 1000;
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSec);
    b.updated = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    if (this.buckets.size > 10000) this.sweep(now);
    return true;
  }

  private sweep(now: number) {
    for (const [k, b] of this.buckets) if (now - b.updated > 600000) this.buckets.delete(k);
  }
}

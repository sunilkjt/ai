// Simple in-memory cache with TTL + debounce helpers for polling.
export class TTLCache<T> {
  private store = new Map<string, { value: T; expires: number }>();
  constructor(private ttlMs: number) {}
  get(key: string): T | null {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expires) {
      this.store.delete(key);
      return null;
    }
    return hit.value;
  }
  set(key: string, value: T): void {
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }
  clear(): void {
    this.store.clear();
  }
}

export function debounce<F extends (...args: never[]) => void>(fn: F, ms: number): F {
  let t: ReturnType<typeof setTimeout> | null = null;
  return ((...args: never[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as F;
}

/** Coalesces refreshes and backs off failures; never serves expired trust data. */
export class AccountCache<T> {
  #value: T | undefined;
  #expiresAt = 0;
  #attemptedAt = -Infinity;
  #failedUntil = 0;
  #failure: unknown;
  #pending: Promise<T> | undefined;
  readonly ttlMs: number;
  readonly cooldownMs: number;
  readonly load: () => Promise<T>;

  constructor(ttlMs: number, cooldownMs: number, load: () => Promise<T>) {
    this.ttlMs = ttlMs;
    this.cooldownMs = cooldownMs;
    this.load = load;
  }

  async get(force = false): Promise<T> {
    const now = Date.now();
    if (this.#pending) return this.#pending;
    if (now < this.#failedUntil) throw this.#failure;
    if (this.#value !== undefined && now < this.#expiresAt && (!force || now - this.#attemptedAt < this.cooldownMs)) return this.#value;
    this.#attemptedAt = now;
    this.#pending = this.load().then((value) => {
      this.#value = value;
      this.#expiresAt = Date.now() + this.ttlMs;
      return value;
    }).catch((error: unknown) => {
      this.#failure = error;
      this.#failedUntil = Date.now() + 1000;
      throw error;
    }).finally(() => { this.#pending = undefined; });
    return this.#pending;
  }
}

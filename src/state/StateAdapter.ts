import type {
    CircuitStateStore,
    CircuitStatus,
    MaybePromise,
    RateLimitSnapshot,
    RateLimitStore,
} from '../types.js';

/**
 * Generic key/value state backend shared across stateful collaborators
 * (rate limiter, circuit breaker). One adapter can back several components via
 * the `*StoreFromAdapter` bridges below — e.g. a single Redis adapter powers
 * cross-process rate-limit + circuit state through one connection.
 *
 * Zero-dependency by contract: the interface lives here; concrete distributed
 * backends (Redis, Memcached, …) ship as opt-in peer deps gated on maintainer
 * sign-off and implement this interface from outside core.
 *
 * Stored values are treated as opaque JSON-serializable snapshots. `ttlMs` is a
 * best-effort expiry hint — backends may ignore it; correctness must not depend
 * on it (the in-process layer already revalidates timestamps).
 */
export interface StateAdapter<T = unknown> {
    get(key: string): MaybePromise<T | undefined>;
    set(key: string, value: T, ttlMs?: number): MaybePromise<void>;
    delete?(key: string): MaybePromise<void>;
    keys?(): MaybePromise<Iterable<string>>;
    clear?(): MaybePromise<void>;
}

interface MemoryEntry<T> {
    value: T;
    expiresAt: number;
}

/**
 * In-process reference {@link StateAdapter} — Map-backed, TTL-aware, zero-dep.
 * Single-process only (no cross-process sharing); use a distributed adapter for
 * multi-instance deployments. Expiry is lazy (checked on read) plus an optional
 * unref'd sweep so it never holds the event loop open.
 */
export class MemoryStateAdapter<T = unknown> implements StateAdapter<T> {
    readonly #entries = new Map<string, MemoryEntry<T>>();
    readonly #sweepTimer: NodeJS.Timeout | null = null;

    constructor(options: { readonly sweepIntervalMs?: number } = {}) {
        const interval = options.sweepIntervalMs ?? 60_000;
        if (interval > 0 && typeof setInterval === 'function') {
            this.#sweepTimer = setInterval(() => this.#sweep(), interval);
            this.#sweepTimer.unref?.();
        }
    }

    get(key: string): T | undefined {
        const entry = this.#entries.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt !== Infinity && Date.now() > entry.expiresAt) {
            this.#entries.delete(key);
            return undefined;
        }
        return entry.value;
    }

    set(key: string, value: T, ttlMs?: number): void {
        this.#entries.set(key, {
            value,
            expiresAt: ttlMs !== undefined && ttlMs > 0 ? Date.now() + ttlMs : Infinity,
        });
    }

    delete(key: string): void {
        this.#entries.delete(key);
    }

    keys(): Iterable<string> {
        return [...this.#entries.keys()];
    }

    clear(): void {
        this.#entries.clear();
    }

    destroy(): void {
        if (this.#sweepTimer) clearInterval(this.#sweepTimer);
        this.#entries.clear();
    }

    #sweep(): void {
        const now = Date.now();
        for (const [key, entry] of this.#entries) {
            if (entry.expiresAt !== Infinity && now > entry.expiresAt) this.#entries.delete(key);
        }
    }
}

/**
 * Prefix every key of an existing adapter with `prefix:`. Lets one shared
 * backend host multiple logical namespaces (e.g. per-tenant) without collision.
 */
export function namespaceAdapter<T>(adapter: StateAdapter<T>, prefix: string): StateAdapter<T> {
    const tag = `${prefix}:`;
    const strip = (key: string): string => (key.startsWith(tag) ? key.slice(tag.length) : key);
    return {
        get: key => adapter.get(`${tag}${key}`),
        set: (key, value, ttlMs) => adapter.set(`${tag}${key}`, value, ttlMs),
        ...(adapter.delete ? { delete: (key: string) => adapter.delete?.(`${tag}${key}`) } : {}),
        ...(adapter.keys
            ? {
                keys: async (): Promise<Iterable<string>> => {
                    const keys = await adapter.keys?.();
                    return [...(keys ?? [])].filter(k => k.startsWith(tag)).map(strip);
                },
            }
            : {}),
        ...(adapter.clear ? { clear: () => adapter.clear?.() } : {}),
    };
}

/**
 * Bridge a generic {@link StateAdapter} to a {@link CircuitStateStore} so a
 * shared backend can hold circuit-breaker state. Wire into
 * `resilience.circuitBreakerStorage.store`.
 */
export function circuitStoreFromAdapter(adapter: StateAdapter): CircuitStateStore {
    return {
        get: async key => (await adapter.get(key)) as CircuitStatus | undefined,
        set: (key, value) => adapter.set(key, value),
        ...(adapter.delete ? { delete: (key: string) => adapter.delete?.(key) } : {}),
        ...(adapter.keys ? { keys: () => adapter.keys?.() ?? [] } : {}),
    };
}

/**
 * Bridge a generic {@link StateAdapter} to a {@link RateLimitStore} so a shared
 * backend can hold limiter state. Wire into
 * `security.rateLimit.storage.store`. Best-effort + non-atomic, same as the
 * underlying rate-limiter contract.
 */
export function rateLimitStoreFromAdapter(adapter: StateAdapter): RateLimitStore {
    return {
        get: async key => (await adapter.get(key)) as RateLimitSnapshot | undefined,
        set: (key, value) => adapter.set(key, value),
        ...(adapter.delete ? { delete: (key: string) => adapter.delete?.(key) } : {}),
    };
}

import type { StateAdapter } from './StateAdapter.js';

/**
 * Minimal structural contract satisfied by both `ioredis` and `node-redis` v4
 * client instances. Neutrx imports no Redis package — the application supplies
 * its own connected client, so {@link RedisStateAdapter} adds **zero runtime
 * dependencies** to the install graph (dependency injection). Anything matching
 * this shape works (a cluster client, a thin shim, a mock in tests).
 */
export interface RedisLikeClient {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
    /** Set a per-key expiry in milliseconds (both clients expose `pexpire`). */
    pexpire(key: string, ttlMs: number): Promise<unknown>;
    del(key: string | string[]): Promise<unknown>;
    /** Glob match. NOTE: `KEYS` is O(N) and blocks Redis — see `keys()` caveat. */
    keys(pattern: string): Promise<string[]>;
}

export interface RedisStateAdapterOptions {
    /** A connected `ioredis` / `node-redis` (or compatible) client. */
    readonly client: RedisLikeClient;
    /** Key namespace; every key is stored as `${keyPrefix}${key}` (default `neutrx:`). */
    readonly keyPrefix?: string;
    /** Override JSON encoding (default `JSON.stringify`). */
    readonly serialize?: (value: unknown) => string;
    /** Override JSON decoding (default `JSON.parse`). */
    readonly deserialize?: (raw: string) => unknown;
}

const defaultSerialize = (value: unknown): string => JSON.stringify(value);
const defaultDeserialize = (raw: string): unknown => JSON.parse(raw) as unknown;

/**
 * Distributed {@link StateAdapter} backed by a user-supplied Redis client.
 *
 * Bridge it into rate-limit / circuit-breaker state with
 * `rateLimitStoreFromAdapter` / `circuitStoreFromAdapter` so multiple Neutrx
 * instances share one backend. Values are JSON-serialized opaque snapshots;
 * `ttlMs` maps to `PEXPIRE` (best-effort, per the {@link StateAdapter} contract).
 *
 * **Server-only.** **Not atomic:** `set` + `pexpire` are two round-trips, and the
 * bridged limiter/circuit contracts are themselves best-effort + non-atomic, so
 * concurrent writers can race — correctness never depends on it (the in-process
 * layer revalidates timestamps).
 *
 * **`keys()` / `clear()` use Redis `KEYS prefix*`** — O(N) over the keyspace and
 * blocking on large databases. They scope strictly to `keyPrefix` (so `clear()`
 * never wipes unrelated keys / the whole DB), but for hot production paths prefer
 * a backend that doesn't enumerate, or a dedicated namespace DB.
 */
export class RedisStateAdapter<T = unknown> implements StateAdapter<T> {
    readonly #client: RedisLikeClient;
    readonly #prefix: string;
    readonly #serialize: (value: unknown) => string;
    readonly #deserialize: (raw: string) => unknown;

    constructor(options: RedisStateAdapterOptions) {
        if (!options.client || typeof options.client.get !== 'function') {
            throw new TypeError('RedisStateAdapter requires a connected Redis-compatible client.');
        }
        this.#client = options.client;
        this.#prefix = options.keyPrefix ?? 'neutrx:';
        this.#serialize = options.serialize ?? defaultSerialize;
        this.#deserialize = options.deserialize ?? defaultDeserialize;
    }

    async get(key: string): Promise<T | undefined> {
        const raw = await this.#client.get(this.#k(key));
        if (raw === null || raw === undefined) return undefined;
        return this.#deserialize(raw) as T;
    }

    async set(key: string, value: T, ttlMs?: number): Promise<void> {
        const namespaced = this.#k(key);
        await this.#client.set(namespaced, this.#serialize(value));
        if (ttlMs !== undefined && ttlMs > 0) {
            await this.#client.pexpire(namespaced, Math.ceil(ttlMs));
        }
    }

    async delete(key: string): Promise<void> {
        await this.#client.del(this.#k(key));
    }

    async keys(): Promise<Iterable<string>> {
        const found = await this.#client.keys(`${this.#prefix}*`);
        return found.map(k => this.#strip(k));
    }

    async clear(): Promise<void> {
        const found = await this.#client.keys(`${this.#prefix}*`);
        if (found.length > 0) await this.#client.del(found);
    }

    #k(key: string): string {
        return `${this.#prefix}${key}`;
    }

    #strip(key: string): string {
        return key.startsWith(this.#prefix) ? key.slice(this.#prefix.length) : key;
    }
}

/**
 * DataLoader — opt-in request/batch aggregation utility.
 *
 * Coalesces many individual `.load(key)` calls issued within the same execution
 * frame into a single user-supplied batch function call, and (optionally) caches
 * the per-key promise for the loader's lifetime. Modeled on the canonical
 * DataLoader contract (batch + per-key memoization).
 *
 * This is a standalone helper: nothing in the Neutrx request pipeline invokes it
 * unless application code constructs a loader and calls `.load(...)`. It is
 * therefore purely additive and does not change any default request behavior.
 * Zero runtime dependencies — pure JS, runs in Node and the browser.
 *
 * The batch function may return values OR `Error` instances per slot; an `Error`
 * in slot `i` rejects the promise for `keys[i]` without failing the whole batch.
 */

/** Resolve a batch of keys to values aligned by index. Length must equal `keys`. */
export type BatchLoadFn<K, V> = (keys: ReadonlyArray<K>) => Promise<ArrayLike<V | Error>>;

/** Schedule the batch dispatch callback. Default drains on the microtask queue. */
export type BatchScheduleFn = (callback: () => void) => void;

/** Minimal cache surface — any Map-like object works (e.g. an LRU). */
export interface CacheMap<C, V> {
    get(cacheKey: C): Promise<V> | undefined;
    set(cacheKey: C, value: Promise<V>): unknown;
    delete(cacheKey: C): unknown;
    clear(): unknown;
}

export interface DataLoaderOptions<K, V, C = K> {
    /** Batch `.load` calls (default `true`). When `false`, each call dispatches alone. */
    readonly batch?: boolean;
    /** Max keys per batch-function call; larger batches are split into chunks. */
    readonly maxBatchSize?: number;
    /** Override when the pending batch is dispatched (default: microtask). */
    readonly batchScheduleFn?: BatchScheduleFn;
    /** Memoize per-key promises for the loader's lifetime (default `true`). */
    readonly cache?: boolean;
    /** Derive the cache key from a load key (default identity). Use for object keys. */
    readonly cacheKeyFn?: (key: K) => C;
    /** Supply a custom cache store (default `new Map`). */
    readonly cacheMap?: CacheMap<C, V> | null;
    /** Optional label for diagnostics. */
    readonly name?: string;
}

interface Job<K, V> {
    readonly key: K;
    resolve(value: V): void;
    reject(error: Error): void;
}

const defaultSchedule: BatchScheduleFn = callback => {
    queueMicrotask(callback);
};

export default class DataLoader<K, V, C = K> {
    readonly name: string | null;

    readonly #batchLoadFn: BatchLoadFn<K, V>;
    readonly #batch: boolean;
    readonly #maxBatchSize: number;
    readonly #schedule: BatchScheduleFn;
    readonly #cacheKeyFn: (key: K) => C;
    readonly #cacheMap: CacheMap<C, V> | null;

    #queue: Job<K, V>[] = [];
    #dispatchScheduled = false;

    constructor(batchLoadFn: BatchLoadFn<K, V>, options: DataLoaderOptions<K, V, C> = {}) {
        if (typeof batchLoadFn !== 'function') {
            throw new TypeError('DataLoader requires a batch load function.');
        }
        this.#batchLoadFn = batchLoadFn;
        this.#batch = options.batch !== false;
        this.#maxBatchSize = normalizeMaxBatchSize(options.batch === false ? 1 : options.maxBatchSize);
        this.#schedule = options.batchScheduleFn ?? defaultSchedule;
        this.#cacheKeyFn = options.cacheKeyFn ?? (key => key as unknown as C);
        this.#cacheMap = resolveCacheMap(options);
        this.name = options.name ?? null;
    }

    /** Load a single key. Identical keys in the same frame share one batch slot. */
    load(key: K): Promise<V> {
        const cacheMap = this.#cacheMap;
        const cacheKey = cacheMap ? this.#cacheKeyFn(key) : (undefined as unknown as C);

        if (cacheMap) {
            const cached = cacheMap.get(cacheKey);
            if (cached !== undefined) return cached;
        }

        const promise = new Promise<V>((resolve, reject) => {
            this.#queue.push({ key, resolve, reject });
            this.#scheduleDispatch();
        });

        if (cacheMap) {
            // Don't poison the cache with a rejected load — let it be retried.
            const cachable = promise.catch(error => {
                if (cacheMap.get(cacheKey) === cachable) cacheMap.delete(cacheKey);
                throw error;
            });
            cacheMap.set(cacheKey, cachable);
            return cachable;
        }

        return promise;
    }

    /** Load many keys; each slot resolves to a value or an `Error` (never throws). */
    loadMany(keys: ReadonlyArray<K>): Promise<Array<V | Error>> {
        return Promise.all(keys.map(key => this.load(key).catch((error: unknown) => toError(error))));
    }

    /** Evict one key from the cache so its next load re-dispatches. */
    clear(key: K): this {
        this.#cacheMap?.delete(this.#cacheKeyFn(key));
        return this;
    }

    /** Evict every cached key. */
    clearAll(): this {
        this.#cacheMap?.clear();
        return this;
    }

    /** Seed the cache so `load(key)` resolves without hitting the batch function. */
    prime(key: K, value: V | Error): this {
        const cacheMap = this.#cacheMap;
        if (!cacheMap) return this;
        const cacheKey = this.#cacheKeyFn(key);
        if (cacheMap.get(cacheKey) === undefined) {
            cacheMap.set(cacheKey, value instanceof Error ? rejected(value) : Promise.resolve(value));
        }
        return this;
    }

    #scheduleDispatch(): void {
        if (this.#dispatchScheduled) return;
        this.#dispatchScheduled = true;
        this.#schedule(() => {
            this.#dispatchScheduled = false;
            this.#dispatch();
        });
    }

    #dispatch(): void {
        const queue = this.#queue;
        this.#queue = [];
        if (queue.length === 0) return;

        if (!this.#batch || queue.length <= this.#maxBatchSize) {
            void this.#runBatch(queue);
            return;
        }
        for (let i = 0; i < queue.length; i += this.#maxBatchSize) {
            void this.#runBatch(queue.slice(i, i + this.#maxBatchSize));
        }
    }

    async #runBatch(jobs: Job<K, V>[]): Promise<void> {
        const keys = jobs.map(job => job.key);
        let values: ArrayLike<V | Error>;
        try {
            values = await this.#batchLoadFn(keys);
        } catch (error) {
            const failure = toError(error);
            for (const job of jobs) job.reject(failure);
            return;
        }

        if (values == null || typeof values.length !== 'number' || values.length !== keys.length) {
            const failure = new TypeError(
                `DataLoader batch function must resolve to an array of the same length (${keys.length}) as the keys; got ${describeLength(values)}.`
            );
            for (const job of jobs) job.reject(failure);
            return;
        }

        for (let i = 0; i < jobs.length; i++) {
            const job = jobs[i];
            if (job === undefined) continue;
            const value = values[i] as V | Error;
            if (value instanceof Error) job.reject(value);
            else job.resolve(value);
        }
    }
}

function normalizeMaxBatchSize(size: number | undefined): number {
    if (size === undefined) return Infinity;
    if (!Number.isInteger(size) || size < 1) {
        throw new TypeError(`DataLoader maxBatchSize must be a positive integer; got ${String(size)}.`);
    }
    return size;
}

function resolveCacheMap<K, V, C>(options: DataLoaderOptions<K, V, C>): CacheMap<C, V> | null {
    if (options.cache === false) return null;
    if (options.cacheMap === null) return null;
    return options.cacheMap ?? new Map<C, Promise<V>>();
}

function toError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
}

function rejected<V>(error: Error): Promise<V> {
    const promise = Promise.reject(error);
    // Swallow the "unhandled rejection" warning for primed errors never loaded.
    promise.catch(() => undefined);
    return promise;
}

function describeLength(values: unknown): string {
    if (values == null) return String(values);
    const length = (values as { length?: unknown }).length;
    return typeof length === 'number' ? String(length) : 'a non-array';
}

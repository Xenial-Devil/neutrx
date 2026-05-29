import crypto from 'node:crypto';

import type { CacheRecord, CacheStats, CacheStore, Headers, InternalRequestConfig, NeutrxResponse, PerformanceConfig } from '../types.js';

interface NormalizedCacheConfig {
    readonly enabled: boolean;
    readonly maxSize: number;
    readonly defaultTTL: number;
    readonly maxEntrySize: number;
    readonly respectCacheHeaders: boolean;
    readonly strategy: 'ttl' | 'stale-while-revalidate';
    readonly staleMaxAge: number;
}

export interface CacheLookup {
    readonly response: NeutrxResponse;
    readonly state: 'fresh' | 'stale';
}

interface MutableStats {
    hits: number;
    misses: number;
    evictions: number;
    sets: number;
}

export default class CacheEngine {
    #store: CacheStore;
    #config: NormalizedCacheConfig;
    #stats: MutableStats = { hits: 0, misses: 0, evictions: 0, sets: 0 };
    #sweepTimer: NodeJS.Timeout | null = null;

    constructor(config: PerformanceConfig = {}) {
        this.#store = config.cacheAdapter ?? new MemoryCacheStore();
        this.#config = {
            enabled: config.enableCaching ?? true,
            maxSize: config.cacheMaxSize ?? 500,
            defaultTTL: config.cacheTTL ?? 300_000,
            maxEntrySize: config.cacheMaxEntrySize ?? 1_048_576,
            respectCacheHeaders: config.respectCacheHeaders ?? true,
            strategy: config.cacheStrategy ?? 'ttl',
            staleMaxAge: config.cacheStaleMax ?? Math.max(config.cacheTTL ?? 300_000, 1_500_000),
        };

        if (this.#config.enabled) {
            this.#sweepTimer = setInterval(() => this.#sweep(), 60_000);
            this.#sweepTimer.unref();
        }
    }

    get(config: InternalRequestConfig): NeutrxResponse | null {
        return this.getWithState(config)?.response ?? null;
    }

    getWithState(config: InternalRequestConfig): CacheLookup | null {
        if (!this.#config.enabled) return null;

        const key = this.#key(config);
        const entry = this.#store.get(key);
        const now = Date.now();

        if (!entry) {
            this.#stats.misses += 1;
            return null;
        }

        if (now > entry.expiresAt && (this.#config.strategy !== 'stale-while-revalidate' || now > entry.staleUntil)) {
            if (now > entry.staleIfErrorUntil) this.#store.delete(key);
            this.#stats.misses += 1;
            return null;
        }

        const touched = this.#touch(key, entry, now);
        this.#stats.hits += 1;

        const state = now > touched.expiresAt ? 'stale' : 'fresh';
        return {
            state,
            response: {
                ...touched.response,
                cached: true,
                stale: state === 'stale',
                cacheAge: now - touched.createdAt,
                headers: {
                    ...touched.response.headers,
                    'x-cache': state === 'stale' ? 'STALE' : 'HIT',
                    'x-cache-age': String(Math.floor((now - touched.createdAt) / 1000)),
                },
            },
        };
    }

    set(config: InternalRequestConfig, response: NeutrxResponse): void {
        if (!this.#config.enabled || !this.#isCacheable(response)) return;

        const size = this.#size(response);
        if (size > this.#config.maxEntrySize) return;

        if ([...this.#store.keys()].length >= this.#config.maxSize) this.#evict();

        const ttl = this.#ttl(response) ?? this.#config.defaultTTL;
        const staleIfError = this.#staleIfError(response);
        const now = Date.now();
        this.#store.set(this.#key(config), {
            response: { ...response },
            createdAt: now,
            expiresAt: now + ttl,
            staleUntil: now + Math.max(ttl, this.#config.staleMaxAge),
            staleIfErrorUntil: now + ttl + staleIfError,
            lastAccessed: now,
            size,
        });

        this.#stats.sets += 1;
    }

    clear(pattern?: string): void {
        if (!pattern) {
            this.#store.clear();
            return;
        }

        const expression = new RegExp(pattern);
        for (const key of this.#store.keys()) {
            if (expression.test(key)) this.#store.delete(key);
        }
    }

    reset(): void {
        this.#stats = { hits: 0, misses: 0, evictions: 0, sets: 0 };
    }

    markRevalidating(config: InternalRequestConfig): boolean {
        const key = this.#key(config);
        const entry = this.#store.get(key);
        if (!entry || entry.revalidatingAt !== undefined) return false;
        if (this.#store.lock && !this.#store.lock(key)) return false;
        this.#store.set(key, { ...entry, revalidatingAt: Date.now() });
        return true;
    }

    finishRevalidating(config: InternalRequestConfig): void {
        const key = this.#key(config);
        const entry = this.#store.get(key);
        if (entry) {
            const next = { ...entry };
            delete next.revalidatingAt;
            this.#store.set(key, next);
        }
        this.#store.unlock?.(key);
    }

    getStaleIfError(config: InternalRequestConfig): NeutrxResponse | null {
        if (!this.#config.enabled) return null;
        const entry = this.#store.get(this.#key(config));
        const now = Date.now();
        if (!entry || now <= entry.expiresAt || now > entry.staleIfErrorUntil) return null;

        const touched = this.#touch(this.#key(config), entry, now);
        this.#stats.hits += 1;
        return {
            ...touched.response,
            cached: true,
            stale: true,
            cacheAge: now - touched.createdAt,
            headers: {
                ...touched.response.headers,
                warning: '110 - "Response is stale"',
                'x-cache': 'STALE-IF-ERROR',
                'x-cache-age': String(Math.floor((now - touched.createdAt) / 1000)),
            },
        };
    }

    revalidationHeaders(config: InternalRequestConfig): Headers {
        const entry = this.#store.get(this.#key(config));
        if (!entry) return {};
        return {
            ...(entry.response.headers.etag ? { 'If-None-Match': entry.response.headers.etag } : {}),
            ...(entry.response.headers['last-modified'] ? { 'If-Modified-Since': entry.response.headers['last-modified'] } : {}),
        };
    }

    refresh(config: InternalRequestConfig, headers: Headers): void {
        const key = this.#key(config);
        const entry = this.#store.get(key);
        if (!entry) return;

        const response = { ...entry.response, headers: { ...entry.response.headers, ...headers } };
        const ttl = this.#ttl(response) ?? this.#config.defaultTTL;
        const staleIfError = this.#staleIfError(response);
        const now = Date.now();
        this.#store.set(key, {
            ...entry,
            response,
            createdAt: now,
            expiresAt: now + ttl,
            staleUntil: now + Math.max(ttl, this.#config.staleMaxAge),
            staleIfErrorUntil: now + ttl + staleIfError,
            lastAccessed: now,
        });
    }

    destroy(): void {
        if (this.#sweepTimer) clearInterval(this.#sweepTimer);
        this.#store.destroy?.();
    }

    getStats(): CacheStats {
        const total = this.#stats.hits + this.#stats.misses;
        return {
            ...this.#stats,
            size: [...this.#store.keys()].length,
            maxSize: this.#config.maxSize,
            hitRate: total > 0 ? `${((this.#stats.hits / total) * 100).toFixed(1)}%` : '0%',
        };
    }

    #key(config: InternalRequestConfig): string {
        return crypto
            .createHash('sha256')
            .update(JSON.stringify({
                socketPath: config.socketPath ?? '',
                url: config.url,
                accept: config.headers.Accept ?? config.headers.accept ?? '',
                authorization: config.headers.Authorization ?? config.headers.authorization ?? '',
            }))
            .digest('hex');
    }

    #isCacheable(response: NeutrxResponse): boolean {
        if (response.status < 200 || response.status >= 300) return false;
        const cacheControl = headerToString(response.headers['cache-control']);
        return !cacheControl.includes('no-store') && !cacheControl.includes('no-cache') && !cacheControl.includes('private');
    }

    #ttl(response: NeutrxResponse): number | null {
        if (!this.#config.respectCacheHeaders) return null;

        const cacheControl = headerToString(response.headers['cache-control']);
        const maxAge = cacheControl.match(/max-age=(\d+)/);
        if (maxAge?.[1]) return Number.parseInt(maxAge[1], 10) * 1000;

        const expires = response.headers.expires;
        if (expires) {
            const timestamp = new Date(headerToString(expires)).getTime() - Date.now();
            if (timestamp > 0) return timestamp;
        }

        return null;
    }

    #staleIfError(response: NeutrxResponse): number {
        if (!this.#config.respectCacheHeaders) return 0;
        const cacheControl = headerToString(response.headers['cache-control']);
        const match = cacheControl.match(/stale-if-error=(\d+)/);
        return match?.[1] ? Number.parseInt(match[1], 10) * 1000 : 0;
    }

    #evict(): void {
        let oldestKey: string | null = null;
        let oldestTime = Number.POSITIVE_INFINITY;

        for (const key of this.#store.keys()) {
            const value = this.#store.get(key);
            if (!value) continue;
            if (value.lastAccessed < oldestTime) {
                oldestTime = value.lastAccessed;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.#store.delete(oldestKey);
            this.#stats.evictions += 1;
        }
    }

    #sweep(): void {
        const now = Date.now();
        for (const key of this.#store.keys()) {
            const value = this.#store.get(key);
            if (!value) continue;
            const expiresAt = Math.max(
                this.#config.strategy === 'stale-while-revalidate' ? value.staleUntil : value.expiresAt,
                value.staleIfErrorUntil
            );
            if (now > expiresAt) this.#store.delete(key);
        }
    }

    #touch(key: string, entry: CacheRecord, lastAccessed: number): CacheRecord {
        const next = { ...entry, lastAccessed };
        this.#store.set(key, next);
        return next;
    }

    #size(response: NeutrxResponse): number {
        try {
            return Buffer.byteLength(JSON.stringify({
                status: response.status,
                headers: response.headers,
                data: Buffer.isBuffer(response.data) ? response.data.toString('base64') : response.data,
            }));
        } catch {
            return 0;
        }
    }
}

class MemoryCacheStore implements CacheStore {
    #entries = new Map<string, CacheRecord>();
    #locks = new Set<string>();

    get(key: string): CacheRecord | undefined {
        return this.#entries.get(key);
    }

    set(key: string, value: CacheRecord): void {
        this.#entries.set(key, value);
    }

    delete(key: string): void {
        this.#entries.delete(key);
        this.#locks.delete(key);
    }

    clear(): void {
        this.#entries.clear();
        this.#locks.clear();
    }

    keys(): Iterable<string> {
        return this.#entries.keys();
    }

    lock(key: string): boolean {
        if (this.#locks.has(key)) return false;
        this.#locks.add(key);
        return true;
    }

    unlock(key: string): void {
        this.#locks.delete(key);
    }
}

function headerToString(value: NeutrxResponse['headers'][string] | undefined): string {
    if (value == null) return '';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
}

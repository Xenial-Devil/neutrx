import crypto from 'node:crypto';

import type { CacheStats, InternalRequestConfig, NeutrxResponse, PerformanceConfig } from '../types.js';

interface NormalizedCacheConfig {
    readonly enabled: boolean;
    readonly maxSize: number;
    readonly defaultTTL: number;
    readonly maxEntrySize: number;
    readonly respectCacheHeaders: boolean;
    readonly strategy: 'ttl' | 'stale-while-revalidate';
    readonly staleMaxAge: number;
}

interface CacheEntry {
    readonly response: NeutrxResponse;
    readonly createdAt: number;
    readonly expiresAt: number;
    readonly staleUntil: number;
    lastAccessed: number;
    revalidatingAt?: number;
    readonly size: number;
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
    #store = new Map<string, CacheEntry>();
    #config: NormalizedCacheConfig;
    #stats: MutableStats = { hits: 0, misses: 0, evictions: 0, sets: 0 };
    #sweepTimer: NodeJS.Timeout | null = null;

    constructor(config: PerformanceConfig = {}) {
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
            this.#store.delete(key);
            this.#stats.misses += 1;
            return null;
        }

        entry.lastAccessed = now;
        this.#stats.hits += 1;

        const state = now > entry.expiresAt ? 'stale' : 'fresh';
        return {
            state,
            response: {
                ...entry.response,
                cached: true,
                stale: state === 'stale',
                cacheAge: now - entry.createdAt,
                headers: {
                    ...entry.response.headers,
                    'x-cache': state === 'stale' ? 'STALE' : 'HIT',
                    'x-cache-age': String(Math.floor((now - entry.createdAt) / 1000)),
                },
            },
        };
    }

    set(config: InternalRequestConfig, response: NeutrxResponse): void {
        if (!this.#config.enabled || !this.#isCacheable(response)) return;

        const size = this.#size(response);
        if (size > this.#config.maxEntrySize) return;

        if (this.#store.size >= this.#config.maxSize) this.#evict();

        const ttl = this.#ttl(response) ?? this.#config.defaultTTL;
        const now = Date.now();
        this.#store.set(this.#key(config), {
            response: { ...response },
            createdAt: now,
            expiresAt: now + ttl,
            staleUntil: now + Math.max(ttl, this.#config.staleMaxAge),
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
        const entry = this.#store.get(this.#key(config));
        if (!entry || entry.revalidatingAt !== undefined) return false;
        entry.revalidatingAt = Date.now();
        return true;
    }

    finishRevalidating(config: InternalRequestConfig): void {
        const entry = this.#store.get(this.#key(config));
        if (entry) delete entry.revalidatingAt;
    }

    destroy(): void {
        if (this.#sweepTimer) clearInterval(this.#sweepTimer);
    }

    getStats(): CacheStats {
        const total = this.#stats.hits + this.#stats.misses;
        return {
            ...this.#stats,
            size: this.#store.size,
            maxSize: this.#config.maxSize,
            hitRate: total > 0 ? `${((this.#stats.hits / total) * 100).toFixed(1)}%` : '0%',
        };
    }

    #key(config: InternalRequestConfig): string {
        return crypto
            .createHash('sha256')
            .update(JSON.stringify({
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

    #evict(): void {
        let oldestKey: string | null = null;
        let oldestTime = Number.POSITIVE_INFINITY;

        for (const [key, value] of this.#store) {
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
        for (const [key, value] of this.#store) {
            const expiresAt = this.#config.strategy === 'stale-while-revalidate' ? value.staleUntil : value.expiresAt;
            if (now > expiresAt) this.#store.delete(key);
        }
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

function headerToString(value: NeutrxResponse['headers'][string] | undefined): string {
    if (value == null) return '';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
}

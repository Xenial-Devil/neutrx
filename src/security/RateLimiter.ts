import { NeutrxRateLimitError } from '../core/NeutrxError.js';
import type { RateLimitConfig, RateLimitSnapshot, RateLimitStorageConfig } from '../types.js';

export const ALGORITHMS = {
    TOKEN_BUCKET: 'token_bucket',
    SLIDING_WINDOW: 'sliding_window',
    FIXED_WINDOW: 'fixed_window',
} as const;

type Algorithm = typeof ALGORITHMS[keyof typeof ALGORITHMS];

interface NormalizedRateLimitConfig {
    readonly enabled: boolean;
    readonly algorithm: Algorithm;
    readonly maxRequests: number;
    readonly windowMs: number;
    readonly burstSize: number;
    readonly perDomain: boolean;
    readonly storage?: RateLimitStorageConfig;
}

type LimiterState =
    | { tokens: number; lastRefill: number }
    | { requests: number[] }
    | { count: number; windowId: number };

interface AlgorithmResult {
    readonly allowed: boolean;
    readonly state: LimiterState;
}

export class RateLimiter {
    #limiters = new Map<string, LimiterState>();
    #config: NormalizedRateLimitConfig;

    constructor(config: RateLimitConfig = {}) {
        this.#config = {
            enabled: config.enabled ?? false,
            algorithm: config.algorithm ?? ALGORITHMS.TOKEN_BUCKET,
            maxRequests: config.maxRequests ?? 100,
            windowMs: config.windowMs ?? 60_000,
            burstSize: config.burstSize ?? 20,
            perDomain: config.perDomain ?? true,
            ...(config.storage ? { storage: config.storage } : {}),
        };
    }

    async checkLimit(url: string): Promise<void> {
        if (!this.#config.enabled) return;

        const key = this.#key(url);
        const current = await this.#get(key);
        const { allowed, state } = this.#evaluate(current);
        await this.#set(key, state);

        if (!allowed) {
            throw new NeutrxRateLimitError(this.#target(url));
        }
    }

    #evaluate(current: LimiterState | undefined): AlgorithmResult {
        switch (this.#config.algorithm) {
            case ALGORITHMS.SLIDING_WINDOW:
                return this.#slidingWindow(current);
            case ALGORITHMS.FIXED_WINDOW:
                return this.#fixedWindow(current);
            default:
                return this.#tokenBucket(current);
        }
    }

    #tokenBucket(current: LimiterState | undefined): AlgorithmResult {
        const now = Date.now();
        const bucket = isTokenBucket(current) ? { ...current } : { tokens: this.#config.burstSize, lastRefill: now };

        const elapsed = now - bucket.lastRefill;
        const refillRate = this.#config.maxRequests / this.#config.windowMs;
        bucket.tokens = Math.min(this.#config.burstSize, bucket.tokens + elapsed * refillRate);
        bucket.lastRefill = now;

        if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
            return { allowed: true, state: bucket };
        }
        return { allowed: false, state: bucket };
    }

    #slidingWindow(current: LimiterState | undefined): AlgorithmResult {
        const now = Date.now();
        const windowStart = now - this.#config.windowMs;
        const requests = (isSlidingWindow(current) ? current.requests : []).filter(ts => ts > windowStart);

        if (requests.length < this.#config.maxRequests) {
            requests.push(now);
            return { allowed: true, state: { requests } };
        }
        return { allowed: false, state: { requests } };
    }

    #fixedWindow(current: LimiterState | undefined): AlgorithmResult {
        const now = Date.now();
        const windowId = Math.floor(now / this.#config.windowMs);
        const window = isFixedWindow(current) && current.windowId === windowId
            ? { count: current.count, windowId }
            : { count: 0, windowId };

        if (window.count < this.#config.maxRequests) {
            window.count += 1;
            return { allowed: true, state: window };
        }
        return { allowed: false, state: window };
    }

    async #get(key: string): Promise<LimiterState | undefined> {
        const existing = this.#limiters.get(key);
        if (existing) return existing;

        const stored = await this.#config.storage?.store.get(key);
        if (stored) {
            const hydrated = stateFromSnapshot(stored);
            if (hydrated) {
                this.#limiters.set(key, hydrated);
                return hydrated;
            }
        }
        return undefined;
    }

    async #set(key: string, state: LimiterState): Promise<void> {
        this.#limiters.set(key, state);
        await this.#config.storage?.store.set(key, snapshotFromState(state));
    }

    #key(url: string): string {
        const namespace = safeKeyPart(this.#config.storage?.namespace ?? 'default');
        const scope = this.#config.storage?.scope ?? (this.#config.perDomain ? 'origin' : 'global');
        const target = scope === 'global' ? 'global' : safeKeyPart(this.#target(url));
        return `neutrx:${namespace}:ratelimit:${scope}:${target}`;
    }

    #target(url: string): string {
        if (!this.#config.perDomain) return 'global';
        return this.#domain(url);
    }

    #domain(url: string): string {
        try {
            return new URL(url).hostname;
        } catch {
            return url;
        }
    }
}

function snapshotFromState(state: LimiterState): RateLimitSnapshot {
    if (isTokenBucket(state)) return { tokens: state.tokens, lastRefill: state.lastRefill };
    if (isSlidingWindow(state)) return { requests: [...state.requests] };
    return { count: state.count, windowId: state.windowId };
}

function stateFromSnapshot(snapshot: RateLimitSnapshot): LimiterState | undefined {
    if (snapshot.tokens !== undefined && snapshot.lastRefill !== undefined) {
        return { tokens: snapshot.tokens, lastRefill: snapshot.lastRefill };
    }
    if (snapshot.requests !== undefined) {
        return { requests: [...snapshot.requests] };
    }
    if (snapshot.count !== undefined && snapshot.windowId !== undefined) {
        return { count: snapshot.count, windowId: snapshot.windowId };
    }
    return undefined;
}

function safeKeyPart(value: string): string {
    return value.replace(/[^a-zA-Z0-9:._-]/g, '_');
}

function isTokenBucket(value: LimiterState | undefined): value is { tokens: number; lastRefill: number } {
    return value !== undefined && 'tokens' in value;
}

function isSlidingWindow(value: LimiterState | undefined): value is { requests: number[] } {
    return value !== undefined && 'requests' in value;
}

function isFixedWindow(value: LimiterState | undefined): value is { count: number; windowId: number } {
    return value !== undefined && 'count' in value;
}

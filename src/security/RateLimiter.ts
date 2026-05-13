import { NeutrxRateLimitError } from '../core/NeutrxError.js';
import type { RateLimitConfig } from '../types.js';

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
}

type LimiterState =
    | { tokens: number; lastRefill: number }
    | { requests: number[] }
    | { count: number; windowId: number };

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
        };
    }

    checkLimit(url: string): void {
        if (!this.#config.enabled) return;

        const key = this.#config.perDomain ? this.#domain(url) : 'global';
        if (!this.#check(key)) {
            throw new NeutrxRateLimitError(key);
        }
    }

    #check(key: string): boolean {
        switch (this.#config.algorithm) {
            case ALGORITHMS.SLIDING_WINDOW:
                return this.#slidingWindow(key);
            case ALGORITHMS.FIXED_WINDOW:
                return this.#fixedWindow(key);
            default:
                return this.#tokenBucket(key);
        }
    }

    #tokenBucket(key: string): boolean {
        const now = Date.now();
        const current = this.#limiters.get(key);
        const bucket = isTokenBucket(current) ? current : { tokens: this.#config.burstSize, lastRefill: now };
        this.#limiters.set(key, bucket);

        const elapsed = now - bucket.lastRefill;
        const refillRate = this.#config.maxRequests / this.#config.windowMs;
        bucket.tokens = Math.min(this.#config.burstSize, bucket.tokens + elapsed * refillRate);
        bucket.lastRefill = now;

        if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
            return true;
        }
        return false;
    }

    #slidingWindow(key: string): boolean {
        const now = Date.now();
        const windowStart = now - this.#config.windowMs;
        const current = this.#limiters.get(key);
        const window = isSlidingWindow(current) ? current : { requests: [] };
        this.#limiters.set(key, window);

        window.requests = window.requests.filter(ts => ts > windowStart);
        if (window.requests.length < this.#config.maxRequests) {
            window.requests.push(now);
            return true;
        }
        return false;
    }

    #fixedWindow(key: string): boolean {
        const now = Date.now();
        const windowId = Math.floor(now / this.#config.windowMs);
        const current = this.#limiters.get(key);
        const window = isFixedWindow(current) ? current : { count: 0, windowId };
        this.#limiters.set(key, window);

        if (window.windowId !== windowId) {
            window.count = 0;
            window.windowId = windowId;
        }

        if (window.count < this.#config.maxRequests) {
            window.count += 1;
            return true;
        }
        return false;
    }

    #domain(url: string): string {
        try {
            return new URL(url).hostname;
        } catch {
            return url;
        }
    }
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

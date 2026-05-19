import { NeutrxMaxRetriesError } from '../core/NeutrxError.js';
import type { HttpMethod, ResilienceConfig, RetryAttempt, RetryContext, RetryBudgetConfig } from '../types.js';

export const STRATEGY = Object.freeze({
    FIXED: 'fixed',
    LINEAR: 'linear',
    EXPONENTIAL: 'exponential',
    FIBONACCI: 'fibonacci',
});

type RetryStrategy = typeof STRATEGY[keyof typeof STRATEGY];

interface NormalizedRetryConfig {
    readonly enabled: boolean;
    readonly maxRetries: number;
    readonly strategy: RetryStrategy;
    readonly baseDelay: number;
    readonly maxDelay: number;
    readonly jitter: boolean;
    readonly retryMethods: readonly HttpMethod[];
    readonly retryBudget?: RetryBudgetConfig;
    readonly retryableStatuses: readonly number[];
    readonly retryableCodes: readonly string[];
    readonly shouldRetry?: (error: Error) => boolean;
    readonly onRetry?: (event: { readonly attempt: number; readonly delay: number; readonly error: Error; readonly context: RetryContext }) => void | Promise<void>;
}

export class RetryEngine {
    #config: NormalizedRetryConfig;
    #fib = [1, 1];
    #retryBudgetSpentAt: number[] = [];

    constructor(config: ResilienceConfig = {}) {
        this.#config = {
            enabled: config.enableRetry ?? true,
            maxRetries: config.maxRetries ?? 3,
            strategy: config.retryStrategy ?? STRATEGY.EXPONENTIAL,
            baseDelay: config.retryDelay ?? 1000,
            maxDelay: config.maxRetryDelay ?? 30_000,
            jitter: config.retryJitter ?? true,
            retryMethods: config.retryMethods ?? ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'],
            ...(config.retryBudget ? { retryBudget: config.retryBudget } : {}),
            retryableStatuses: config.retryableStatuses ?? [408, 429, 500, 502, 503, 504],
            retryableCodes: config.retryableCodes ?? ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENETUNREACH'],
            ...(config.shouldRetry ? { shouldRetry: config.shouldRetry } : {}),
            ...(config.onRetry ? { onRetry: config.onRetry } : {}),
        };
    }

    async execute<TResult>(fn: (attempt: number) => Promise<TResult>, context: RetryContext = {}): Promise<{ readonly result: TResult; readonly attempts: readonly RetryAttempt[] }> {
        if (!this.#config.enabled) {
            const result = await fn(0);
            return { result, attempts: [{ attempt: 0, duration: 0, success: true }] };
        }

        const attempts: RetryAttempt[] = [];
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.#config.maxRetries; attempt += 1) {
            const t0 = Date.now();

            try {
                throwIfAbortedOrExpired(context);
                if (attempt > 0 && lastError) {
                    const delay = this.#delay(attempt, lastError);
                    await this.#config.onRetry?.({ attempt, delay, error: lastError, context });
                    await sleep(delay, context);
                }

                const result = await fn(attempt);
                attempts.push({ attempt, duration: Date.now() - t0, success: true });
                return { result, attempts };
            } catch (error: unknown) {
                lastError = normalizeError(error);
                attempts.push({ attempt, duration: Date.now() - t0, success: false, error: lastError.message });

                if (attempt >= this.#config.maxRetries || !this.#shouldRetry(lastError, context) || !this.#consumeBudget()) {
                    throw lastError;
                }
            }
        }

        throw new NeutrxMaxRetriesError(context.url, this.#config.maxRetries, lastError ?? new Error('Unknown retry failure'), {
            context: { attempts: attempts.length },
        });
    }

    #shouldRetry(error: Error, context: RetryContext): boolean {
        if (this.#config.shouldRetry) return this.#config.shouldRetry(error);

        if (context.method && !this.#config.retryMethods.includes(context.method)) return false;

        const noRetryNames = new Set([
            'NeutrxSecurityError',
            'NeutrxSSRFError',
            'NeutrxInjectionError',
            'NeutrxPrototypePollutionError',
            'NeutrxValidationError',
        ]);
        if (noRetryNames.has(error.name)) return false;

        const enriched = error as Error & { readonly status?: number; readonly code?: string; readonly retryable?: boolean };
        if (typeof enriched.status === 'number') return this.#config.retryableStatuses.includes(enriched.status);
        if (typeof enriched.code === 'string') return this.#config.retryableCodes.includes(enriched.code);
        if (typeof enriched.retryable === 'boolean') return enriched.retryable;

        return false;
    }

    #consumeBudget(): boolean {
        const budget = this.#config.retryBudget;
        if (!budget) return true;

        const now = Date.now();
        this.#retryBudgetSpentAt = this.#retryBudgetSpentAt.filter(timestamp => now - timestamp < budget.windowMs);
        if (this.#retryBudgetSpentAt.length >= budget.maxRetries) return false;
        this.#retryBudgetSpentAt.push(now);
        return true;
    }

    #delay(attempt: number, lastError: Error): number {
        const retryAfter = (lastError as Error & { readonly retryAfter?: string | number }).retryAfter;
        if (retryAfter !== undefined) {
            const retryAfterMs = typeof retryAfter === 'number'
                ? retryAfter
                : Number.isNaN(Number(retryAfter))
                    ? new Date(retryAfter).getTime() - Date.now()
                    : Number.parseInt(retryAfter, 10) * 1000;
            if (retryAfterMs > 0) return Math.min(retryAfterMs, this.#config.maxDelay);
        }

        let base: number;
        switch (this.#config.strategy) {
            case STRATEGY.FIXED:
                base = this.#config.baseDelay;
                break;
            case STRATEGY.LINEAR:
                base = this.#config.baseDelay * attempt;
                break;
            case STRATEGY.FIBONACCI:
                base = this.#config.baseDelay * this.#fibonacci(attempt);
                break;
            default:
                base = this.#config.baseDelay * (2 ** (attempt - 1));
        }

        const jitter = this.#config.jitter ? Math.random() * 1000 : 0;
        return Math.min(base + jitter, this.#config.maxDelay);
    }

    #fibonacci(n: number): number {
        while (this.#fib.length <= n) {
            this.#fib.push((this.#fib.at(-1) ?? 1) + (this.#fib.at(-2) ?? 1));
        }
        return this.#fib[n] ?? 1;
    }
}

function sleep(ms: number, context: RetryContext): Promise<void> {
    if (context.signal?.aborted) return Promise.reject(abortError(context.signal));

    const remaining = context.deadlineAt === undefined ? Number.POSITIVE_INFINITY : context.deadlineAt - Date.now();
    if (remaining <= 0) return Promise.reject(deadlineError());

    const delay = Math.min(ms, remaining);
    const expiresDuringSleep = context.deadlineAt !== undefined && remaining < ms;
    if (delay <= 0) return Promise.resolve();

    return new Promise((resolve, reject) => {
        const onAbort = (): void => {
            clearTimeout(timer);
            reject(abortError(context.signal));
        };
        const timer = setTimeout(() => {
            context.signal?.removeEventListener('abort', onAbort);
            if (expiresDuringSleep) {
                reject(deadlineError());
                return;
            }
            resolve();
        }, delay);
        context.signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function throwIfAbortedOrExpired(context: RetryContext): void {
    if (context.signal?.aborted) throw abortError(context.signal);
    if (context.deadlineAt !== undefined && Date.now() >= context.deadlineAt) {
        throw deadlineError();
    }
}

function deadlineError(): Error {
    return Object.assign(new Error('Retry deadline exceeded'), { code: 'RETRY_DEADLINE_EXCEEDED' });
}

function abortError(signal?: AbortSignal): Error {
    if (signal?.reason instanceof Error) return signal.reason;
    return Object.assign(new Error('Request aborted'), { name: 'AbortError' });
}

function normalizeError(error: unknown): Error {
    if (error instanceof Error) return error;
    return new Error(String(error));
}

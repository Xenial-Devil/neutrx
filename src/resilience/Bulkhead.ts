import { NeutrxBulkheadError } from '../core/NeutrxError.js';
import type { BulkheadStats, ResilienceConfig } from '../types.js';

interface NormalizedBulkheadConfig {
    readonly enabled: boolean;
    readonly maxConcurrent: number;
    readonly maxQueue: number;
    readonly queueTimeout: number;
    readonly adaptive: {
        readonly enabled: boolean;
        readonly minLimit: number;
        readonly maxLimit: number;
        readonly initialLimit: number;
        readonly targetLatency: number;
        readonly increaseStep: number;
        readonly decreaseRatio: number;
    };
}

interface BulkheadPool {
    active: number;
    readonly queue: QueueItem[];
    limit: number;
}

interface QueueItem {
    readonly run: () => void;
    readonly reject: (error: Error) => void;
    readonly timer: NodeJS.Timeout;
}

export default class Bulkhead {
    #config: NormalizedBulkheadConfig;
    #pools = new Map<string, BulkheadPool>();

    constructor(config: ResilienceConfig = {}) {
        this.#config = {
            enabled: config.enableBulkhead ?? true,
            maxConcurrent: config.maxConcurrent ?? 10,
            maxQueue: config.maxQueue ?? 100,
            queueTimeout: config.bulkheadQueueTimeout ?? 30_000,
            adaptive: {
                enabled: config.adaptiveConcurrency?.enabled ?? false,
                minLimit: Math.max(1, config.adaptiveConcurrency?.minLimit ?? 1),
                maxLimit: Math.max(1, config.adaptiveConcurrency?.maxLimit ?? config.maxConcurrent ?? 10),
                initialLimit: Math.max(1, config.adaptiveConcurrency?.initialLimit ?? config.maxConcurrent ?? 10),
                targetLatency: Math.max(1, config.adaptiveConcurrency?.targetLatency ?? 500),
                increaseStep: Math.max(1, config.adaptiveConcurrency?.increaseStep ?? 1),
                decreaseRatio: Math.min(0.99, Math.max(0.1, config.adaptiveConcurrency?.decreaseRatio ?? 0.7)),
            },
        };
    }

    async execute<TResult>(domain: string, task: () => Promise<TResult>): Promise<TResult> {
        if (!this.#config.enabled) return task();

        const pool = this.#pool(domain);
        if (pool.active < pool.limit) {
            return this.#run(pool, task);
        }

        if (pool.queue.length >= this.#config.maxQueue) {
            throw new NeutrxBulkheadError(domain, pool.limit);
        }

        return new Promise<TResult>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.#removeQueued(pool, item);
                reject(new NeutrxBulkheadError(domain, pool.limit, { code: 'BULKHEAD_QUEUE_TIMEOUT' }));
            }, this.#config.queueTimeout);

            const item: QueueItem = {
                timer,
                reject,
                run: () => {
                    clearTimeout(timer);
                    this.#run(pool, task).then(resolve, reject);
                },
            };

            pool.queue.push(item);
        });
    }

    getStats(): BulkheadStats {
        const domains: BulkheadStats['domains'] = {};
        for (const [domain, pool] of this.#pools) {
            domains[domain] = {
                active: pool.active,
                queued: pool.queue.length,
                limit: pool.limit,
                ...(this.#config.adaptive.enabled ? { adaptive: true } : {}),
            };
        }
        return { domains };
    }

    async #run<TResult>(pool: BulkheadPool, task: () => Promise<TResult>): Promise<TResult> {
        pool.active += 1;
        const startedAt = Date.now();
        try {
            const result = await task();
            this.#record(pool, true, Date.now() - startedAt);
            return result;
        } catch (error: unknown) {
            this.#record(pool, false, Date.now() - startedAt);
            throw error;
        } finally {
            pool.active = Math.max(0, pool.active - 1);
            this.#drain(pool);
        }
    }

    #drain(pool: BulkheadPool): void {
        while (pool.active < pool.limit && pool.queue.length > 0) {
            const item = pool.queue.shift();
            item?.run();
        }
    }

    #pool(domain: string): BulkheadPool {
        const existing = this.#pools.get(domain);
        if (existing) return existing;

        const created: BulkheadPool = { active: 0, queue: [], limit: this.#initialLimit() };
        this.#pools.set(domain, created);
        return created;
    }

    #removeQueued(pool: BulkheadPool, item: QueueItem): void {
        const index = pool.queue.indexOf(item);
        if (index >= 0) pool.queue.splice(index, 1);
    }

    #record(pool: BulkheadPool, success: boolean, duration: number): void {
        if (!this.#config.adaptive.enabled) return;
        if (!success || duration > this.#config.adaptive.targetLatency) {
            pool.limit = Math.max(this.#config.adaptive.minLimit, Math.floor(pool.limit * this.#config.adaptive.decreaseRatio));
            return;
        }
        pool.limit = Math.min(this.#config.adaptive.maxLimit, pool.limit + this.#config.adaptive.increaseStep);
    }

    #initialLimit(): number {
        if (!this.#config.adaptive.enabled) return this.#config.maxConcurrent;
        return Math.min(this.#config.adaptive.maxLimit, Math.max(this.#config.adaptive.minLimit, this.#config.adaptive.initialLimit));
    }
}

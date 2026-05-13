import { NeutrxBulkheadError } from '../core/NeutrxError.js';
import type { BulkheadStats, ResilienceConfig } from '../types.js';

interface NormalizedBulkheadConfig {
    readonly enabled: boolean;
    readonly maxConcurrent: number;
    readonly maxQueue: number;
    readonly queueTimeout: number;
}

interface BulkheadPool {
    active: number;
    readonly queue: QueueItem[];
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
        };
    }

    async execute<TResult>(domain: string, task: () => Promise<TResult>): Promise<TResult> {
        if (!this.#config.enabled) return task();

        const pool = this.#pool(domain);
        if (pool.active < this.#config.maxConcurrent) {
            return this.#run(pool, task);
        }

        if (pool.queue.length >= this.#config.maxQueue) {
            throw new NeutrxBulkheadError(domain, this.#config.maxConcurrent);
        }

        return new Promise<TResult>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.#removeQueued(pool, item);
                reject(new NeutrxBulkheadError(domain, this.#config.maxConcurrent, { code: 'BULKHEAD_QUEUE_TIMEOUT' }));
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
            domains[domain] = { active: pool.active, queued: pool.queue.length };
        }
        return { domains };
    }

    async #run<TResult>(pool: BulkheadPool, task: () => Promise<TResult>): Promise<TResult> {
        pool.active += 1;
        try {
            return await task();
        } finally {
            pool.active = Math.max(0, pool.active - 1);
            this.#drain(pool);
        }
    }

    #drain(pool: BulkheadPool): void {
        while (pool.active < this.#config.maxConcurrent && pool.queue.length > 0) {
            const item = pool.queue.shift();
            item?.run();
        }
    }

    #pool(domain: string): BulkheadPool {
        const existing = this.#pools.get(domain);
        if (existing) return existing;

        const created: BulkheadPool = { active: 0, queue: [] };
        this.#pools.set(domain, created);
        return created;
    }

    #removeQueued(pool: BulkheadPool, item: QueueItem): void {
        const index = pool.queue.indexOf(item);
        if (index >= 0) pool.queue.splice(index, 1);
    }
}

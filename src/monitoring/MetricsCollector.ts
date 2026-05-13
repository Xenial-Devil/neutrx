import { EventEmitter } from 'node:events';

export interface MetricsSnapshot {
    readonly requests: {
        readonly total: number;
        readonly success: number;
        readonly errors: number;
        readonly cached: number;
        readonly retried: number;
    };
    readonly performance: {
        readonly min: number;
        readonly max: number;
        readonly avg: number;
        readonly total: number;
        readonly p50: number;
        readonly p90: number;
        readonly p95: number;
        readonly p99: number;
    };
    readonly byStatus: Record<string, number>;
    readonly byEndpoint: Record<string, EndpointMetrics>;
    readonly errors: {
        readonly byType: Record<string, number>;
        readonly byCode: Record<string, number>;
    };
    readonly summary: {
        readonly total: number;
        readonly successRate: string;
        readonly errorRate: string;
        readonly cacheRate: string;
        readonly avgDuration: string;
        readonly p99: string;
    };
}

interface MutableMetrics {
    requests: { total: number; success: number; errors: number; cached: number; retried: number };
    performance: { min: number; max: number; avg: number; total: number; p50: number; p90: number; p95: number; p99: number };
    byStatus: Record<string, number>;
    byEndpoint: Record<string, EndpointMetrics>;
    errors: { byType: Record<string, number>; byCode: Record<string, number> };
}

interface EndpointMetrics {
    total: number;
    success: number;
    errors: number;
    avgDuration: number;
    totalDuration: number;
}

export default class MetricsCollector extends EventEmitter {
    #metrics: MutableMetrics;
    #durations: number[] = [];
    #maxSamples: number;
    #percentileTimer: NodeJS.Timeout;

    constructor(config: { readonly maxSamples?: number } = {}) {
        super();
        this.#maxSamples = config.maxSamples ?? 10_000;
        this.#metrics = this.#fresh();
        this.#percentileTimer = setInterval(() => this.#percentiles(), 10_000);
        this.#percentileTimer.unref();
    }

    recordSuccess(url: string, duration: number, status: number): void {
        this.#metrics.requests.success += 1;
        this.#metrics.requests.total += 1;
        this.#duration(duration);
        this.#inc(this.#metrics.byStatus, String(status));
        this.#endpoint(url, duration, true);
    }

    recordError(url: string, error: Error & { readonly code?: string }): void {
        this.#metrics.requests.errors += 1;
        this.#metrics.requests.total += 1;
        this.#inc(this.#metrics.errors.byType, error.name);
        this.#inc(this.#metrics.errors.byCode, error.code ?? 'UNKNOWN');
        this.#endpoint(url, null, false);
        this.emit('error:recorded', { url, error });
    }

    recordCacheHit(url: string): void {
        this.#metrics.requests.cached += 1;
        this.#metrics.requests.total += 1;
        this.emit('cache:hit', { url });
    }

    recordRetry(url: string, attempt: number): void {
        this.#metrics.requests.retried += 1;
        this.emit('retry:recorded', { url, attempt });
    }

    getAll(): MetricsSnapshot {
        const { total, success, errors, cached } = this.#metrics.requests;
        return {
            ...this.#metrics,
            summary: {
                total,
                successRate: total > 0 ? `${((success / total) * 100).toFixed(2)}%` : '0%',
                errorRate: total > 0 ? `${((errors / total) * 100).toFixed(2)}%` : '0%',
                cacheRate: total > 0 ? `${((cached / total) * 100).toFixed(2)}%` : '0%',
                avgDuration: `${this.#metrics.performance.avg}ms`,
                p99: `${this.#metrics.performance.p99}ms`,
            },
        };
    }

    toPrometheus(): string {
        const metrics = this.#metrics;
        return [
            '# TYPE neutrx_requests_total counter',
            `neutrx_requests_total{status="success"} ${metrics.requests.success}`,
            `neutrx_requests_total{status="error"} ${metrics.requests.errors}`,
            `neutrx_requests_total{status="cached"} ${metrics.requests.cached}`,
            '',
            '# TYPE neutrx_duration_ms summary',
            `neutrx_duration_ms{quantile="0.5"} ${metrics.performance.p50}`,
            `neutrx_duration_ms{quantile="0.9"} ${metrics.performance.p90}`,
            `neutrx_duration_ms{quantile="0.95"} ${metrics.performance.p95}`,
            `neutrx_duration_ms{quantile="0.99"} ${metrics.performance.p99}`,
        ].join('\n');
    }

    reset(): void {
        this.#metrics = this.#fresh();
        this.#durations = [];
    }

    destroy(): void {
        clearInterval(this.#percentileTimer);
    }

    #fresh(): MutableMetrics {
        return {
            requests: { total: 0, success: 0, errors: 0, cached: 0, retried: 0 },
            performance: { min: 0, max: 0, avg: 0, total: 0, p50: 0, p90: 0, p95: 0, p99: 0 },
            byStatus: {},
            byEndpoint: {},
            errors: { byType: {}, byCode: {} },
        };
    }

    #duration(ms: number): void {
        const performance = this.#metrics.performance;
        performance.total += ms;
        performance.min = this.#durations.length === 0 ? ms : Math.min(performance.min, ms);
        performance.max = Math.max(performance.max, ms);
        performance.avg = Math.round(performance.total / this.#metrics.requests.success);

        if (this.#durations.length >= this.#maxSamples) this.#durations.shift();
        this.#durations.push(ms);
        this.#percentiles();
    }

    #percentiles(): void {
        if (!this.#durations.length) return;
        const sorted = [...this.#durations].sort((a, b) => a - b);
        const quantile = (pct: number): number => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * pct))] ?? 0;
        const performance = this.#metrics.performance;
        performance.p50 = quantile(0.50);
        performance.p90 = quantile(0.90);
        performance.p95 = quantile(0.95);
        performance.p99 = quantile(0.99);
    }

    #endpoint(url: string, duration: number | null, success: boolean): void {
        try {
            const { hostname, pathname } = new URL(url);
            const key = `${hostname}${pathname}`;
            const endpoint = this.#metrics.byEndpoint[key] ??= {
                total: 0,
                success: 0,
                errors: 0,
                avgDuration: 0,
                totalDuration: 0,
            };

            endpoint.total += 1;
            if (success) endpoint.success += 1;
            else endpoint.errors += 1;

            if (duration !== null) {
                endpoint.totalDuration += duration;
                endpoint.avgDuration = Math.round(endpoint.totalDuration / Math.max(1, endpoint.success));
            }
        } catch {
            // Invalid URLs are already tracked in error counters.
        }
    }

    #inc(target: Record<string, number>, key: string): void {
        target[key] = (target[key] ?? 0) + 1;
    }
}

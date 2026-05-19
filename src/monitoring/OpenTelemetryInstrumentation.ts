import type { InternalRequestConfig, NeutrxResponse, ParsedResponseData } from '../types.js';

type SpanLike = {
    setAttribute(name: string, value: string | number | boolean): void;
    recordException?(error: Error): void;
    setStatus?(status: { readonly code: number; readonly message?: string }): void;
    end(): void;
};

type TracerLike = {
    startSpan(name: string, options?: { readonly attributes?: Record<string, string | number | boolean> }): SpanLike;
};

type OpenTelemetryApiLike = {
    trace?: { readonly getTracer?: (name: string) => TracerLike };
    propagation?: { readonly inject?: (context: unknown, carrier: Record<string, string>) => void };
    context?: { readonly active?: () => unknown };
    SpanStatusCode?: { readonly ERROR?: number; readonly OK?: number };
};

export class OpenTelemetryInstrumentation {
    #api: OpenTelemetryApiLike | null | undefined;

    async start(config: InternalRequestConfig): Promise<{ readonly span: SpanLike | null; readonly carrier: Record<string, string> }> {
        if (!config.instrumentation?.openTelemetry) return { span: null, carrier: {} };

        const api = await this.#loadApi();
        const tracer = api?.trace?.getTracer?.(config.instrumentation.tracerName ?? 'neutrx');
        const url = new URL(config.url);
        const attributes = {
            'http.request.method': config.method,
            'url.scheme': url.protocol.slice(0, -1),
            'server.address': url.hostname,
            'server.port': Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
            'url.path': url.pathname,
        };
        const span = tracer?.startSpan(`HTTP ${config.method}`, { attributes }) ?? null;
        for (const [name, value] of Object.entries(attributes)) span?.setAttribute(name, value);

        const carrier: Record<string, string> = {};
        if (config.instrumentation.propagateTraceHeaders !== false) {
            api?.propagation?.inject?.(api.context?.active?.(), carrier);
        }

        return { span, carrier };
    }

    finish<TData extends ParsedResponseData>(
        span: SpanLike | null,
        response: NeutrxResponse<TData>,
        details: { readonly retries: number; readonly cacheHit: boolean }
    ): void {
        if (!span) return;
        span.setAttribute('http.response.status_code', response.status);
        span.setAttribute('neutrx.retry.count', details.retries);
        span.setAttribute('neutrx.cache.hit', details.cacheHit);
        if (response.status >= 400) span.setStatus?.({ code: this.#errorStatusCode(), message: response.statusText });
        span.end();
    }

    fail(span: SpanLike | null, error: Error): void {
        if (!span) return;
        span.recordException?.(error);
        span.setStatus?.({ code: this.#errorStatusCode(), message: error.message });
        span.end();
    }

    async #loadApi(): Promise<OpenTelemetryApiLike | null> {
        if (this.#api !== undefined) return this.#api;
        const injected = (globalThis as { readonly __NEUTRX_OTEL_API__?: OpenTelemetryApiLike }).__NEUTRX_OTEL_API__;
        if (injected) {
            this.#api = injected;
            return this.#api;
        }

        try {
            const specifier = '@opentelemetry/api';
            this.#api = await import(specifier) as OpenTelemetryApiLike;
        } catch {
            this.#api = null;
        }
        return this.#api;
    }

    #errorStatusCode(): number {
        return this.#api?.SpanStatusCode?.ERROR ?? 2;
    }
}

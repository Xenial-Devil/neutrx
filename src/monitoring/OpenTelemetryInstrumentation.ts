import type { HeaderValue, InternalRequestConfig, NeutrxResponse, ParsedResponseData } from '../types.js';
import { getHeader, headerToString } from '../core/headers.js';

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

type AttributeValue = string | number | boolean;

export class OpenTelemetryInstrumentation {
    #api: OpenTelemetryApiLike | null | undefined;

    async start(config: InternalRequestConfig): Promise<{ readonly span: SpanLike | null; readonly carrier: Record<string, string> }> {
        if (!config.instrumentation?.openTelemetry) return { span: null, carrier: {} };

        const api = await this.#loadApi();
        const tracer = api?.trace?.getTracer?.(config.instrumentation.tracerName ?? 'neutrx');
        const attributes = requestAttributes(config);
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
        if (response.config.instrumentation?.recordResponseBodySize) {
            setOptionalAttribute(span, 'http.response.body.size', responseBodySize(response));
        }
        span.setAttribute('neutrx.retry.count', details.retries);
        span.setAttribute('neutrx.cache.hit', details.cacheHit);
        if (response.deduplicated !== undefined) span.setAttribute('neutrx.request.deduplicated', response.deduplicated);
        if (response.cached !== undefined) span.setAttribute('neutrx.cache.cached', response.cached);
        if (response.stale !== undefined) span.setAttribute('neutrx.cache.stale', response.stale);
        if (response.status >= 400) span.setStatus?.({ code: this.#errorStatusCode(), message: response.statusText });
        else span.setStatus?.({ code: this.#okStatusCode() });
        span.end();
    }

    fail(span: SpanLike | null, error: Error): void {
        if (!span) return;
        span.recordException?.(error);
        span.setAttribute('error.type', error.name);
        const code = (error as { readonly code?: unknown }).code;
        if (typeof code === 'string') span.setAttribute('neutrx.error.code', code);
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

    #okStatusCode(): number {
        return this.#api?.SpanStatusCode?.OK ?? 1;
    }
}

function requestAttributes(config: InternalRequestConfig): Record<string, AttributeValue> {
    const url = new URL(config.url);
    const attributes: Record<string, AttributeValue> = {
        'http.request.method': config.method,
        'url.scheme': url.protocol.slice(0, -1),
        'url.path': url.pathname,
        'server.address': url.hostname,
        'server.port': portFor(url),
        'network.protocol.name': 'http',
        'network.protocol.version': protocolVersion(config),
        'neutrx.request.id': config.requestId,
        'neutrx.request.timeout_ms': config.timeout,
        'neutrx.request.redirect.max': config.maxRedirects,
        'neutrx.retry.idempotency_key_present': Boolean(config.idempotencyKey),
    };

    const serviceEndpoint = config.serviceEndpoint;
    if (serviceEndpoint) {
        attributes['neutrx.service.endpoint'] = serviceEndpoint.url;
        if (serviceEndpoint.weight !== undefined) attributes['neutrx.service.endpoint.weight'] = serviceEndpoint.weight;
        for (const [key, value] of Object.entries(serviceEndpoint.metadata ?? {})) {
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                attributes[`neutrx.service.endpoint.metadata.${key}`] = value;
            }
        }
    }

    if (config.instrumentation?.recordRequestBodySize) {
        const size = requestBodySize(config);
        if (size !== undefined) attributes['http.request.body.size'] = size;
    }

    return attributes;
}

function portFor(url: URL): number {
    if (url.port) return Number(url.port);
    return url.protocol === 'https:' ? 443 : 80;
}

function protocolVersion(config: InternalRequestConfig): string {
    const version = config.httpVersion;
    if (version === 2 || version === '2') return '2';
    return '1.1';
}

function requestBodySize(config: InternalRequestConfig): number | undefined {
    const contentLength = parseContentLength(getHeader(config.headers, 'Content-Length'));
    if (contentLength !== undefined) return contentLength;
    return payloadSize(config.data);
}

function responseBodySize(response: NeutrxResponse): number | undefined {
    const contentLength = parseContentLength(getHeader(response.headers, 'Content-Length'));
    if (contentLength !== undefined) return contentLength;
    return payloadSize(response.data);
}

function parseContentLength(value: HeaderValue | undefined): number | undefined {
    const rendered = headerToString(value);
    if (!rendered) return undefined;
    const parsed = Number.parseInt(rendered, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function payloadSize(value: unknown): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return Buffer.byteLength(value);
    if (Buffer.isBuffer(value)) return value.byteLength;
    if (value instanceof Uint8Array) return value.byteLength;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size;
    return undefined;
}

function setOptionalAttribute(span: SpanLike, name: string, value: AttributeValue | undefined): void {
    if (value !== undefined) span.setAttribute(name, value);
}

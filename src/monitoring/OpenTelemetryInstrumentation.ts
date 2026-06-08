import type { HeaderValue, InternalRequestConfig, NeutrxResponse, ParsedResponseData, TraceContext } from '../types.js';
import { getHeader, headerToString } from '../core/headers.js';
import { isNeutrxError } from '../core/NeutrxError.js';

type SpanLike = {
    setAttribute(name: string, value: string | number | boolean): void;
    addEvent?(name: string, attributes?: Record<string, string | number | boolean>): void;
    recordException?(error: Error): void;
    setStatus?(status: { readonly code: number; readonly message?: string }): void;
    spanContext?(): {
        readonly traceId: string;
        readonly spanId: string;
        readonly traceFlags: number;
    };
    end(): void;
};

type TracerLike = {
    startSpan(name: string, options?: { readonly attributes?: Record<string, string | number | boolean> }): SpanLike;
};

type OpenTelemetryApiLike = {
    trace?: {
        readonly getTracer?: (name: string) => TracerLike;
        readonly setSpan?: (context: unknown, span: SpanLike) => unknown;
    };
    propagation?: { readonly inject?: (context: unknown, carrier: Record<string, string>) => void };
    context?: { readonly active?: () => unknown };
    SpanStatusCode?: { readonly ERROR?: number; readonly OK?: number };
};

type AttributeValue = string | number | boolean;
type SpanFinishDetails = {
    readonly retries: number;
    readonly cacheHit: boolean;
    readonly durationMs?: number;
    readonly circuitState?: string;
};
type SpanFailureDetails = {
    readonly retries?: number;
    readonly durationMs?: number;
    readonly circuitState?: string;
};

export class OpenTelemetryInstrumentation {
    #api: OpenTelemetryApiLike | null | undefined;
    #ended = new WeakSet<SpanLike>();

    async start(config: InternalRequestConfig): Promise<{
        readonly span: SpanLike | null;
        readonly carrier: Record<string, string>;
        readonly traceContext?: TraceContext;
    }> {
        if (!config.instrumentation?.openTelemetry) return { span: null, carrier: {} };

        const api = await this.#loadApi();
        const tracer = api?.trace?.getTracer?.(config.instrumentation.tracerName ?? 'neutrx');
        const attributes = requestAttributes(config);
        const span = tracer?.startSpan(`HTTP ${config.method}`, { attributes }) ?? null;
        for (const [name, value] of Object.entries(attributes)) span?.setAttribute(name, value);
        const activeContext = api?.context?.active?.();
        const propagationContext = span && activeContext !== undefined
            ? api?.trace?.setSpan?.(activeContext, span) ?? activeContext
            : activeContext;

        const carrier: Record<string, string> = {};
        if (config.instrumentation.propagateTraceHeaders !== false) {
            api?.propagation?.inject?.(propagationContext, carrier);
        }

        const existingTraceContext = config.instrumentation.overwriteTraceHeaders === true
            ? undefined
            : traceContextFromTraceparent(
                headerToString(getHeader(config.headers, 'traceparent')),
                headerToString(getHeader(config.headers, 'tracestate'))
            );
        const traceContext = existingTraceContext ?? traceContextFromSpan(span) ?? traceContextFromCarrier(carrier);
        return { span, carrier, ...(traceContext ? { traceContext } : {}) };
    }

    recordAttempt(span: SpanLike | null, attempt: number): void {
        if (!span) return;
        span.setAttribute('neutrx.retry.count', attempt);
        span.addEvent?.('neutrx.request.attempt', { 'neutrx.retry.attempt': attempt });
    }

    finish<TData extends ParsedResponseData>(
        span: SpanLike | null,
        response: NeutrxResponse<TData>,
        details: SpanFinishDetails
    ): void {
        if (!span) return;
        span.setAttribute('http.response.status_code', response.status);
        if (response.config.instrumentation?.recordResponseBodySize) {
            setOptionalAttribute(span, 'http.response.body.size', responseBodySize(response));
        }
        span.setAttribute('neutrx.retry.count', details.retries);
        span.setAttribute('neutrx.cache.hit', details.cacheHit);
        span.setAttribute('neutrx.cache.result', details.cacheHit ? 'hit' : 'miss');
        span.setAttribute('neutrx.request.duration_ms', details.durationMs ?? response.timing.duration);
        setOptionalAttribute(span, 'neutrx.circuit_breaker.state', details.circuitState);
        if (response.deduplicated !== undefined) span.setAttribute('neutrx.request.deduplicated', response.deduplicated);
        if (response.cached !== undefined) span.setAttribute('neutrx.cache.cached', response.cached);
        if (response.stale !== undefined) span.setAttribute('neutrx.cache.stale', response.stale);
        if (response.status >= 400) span.setStatus?.({ code: this.#errorStatusCode(), message: response.statusText });
        else span.setStatus?.({ code: this.#okStatusCode() });
        this.#end(span);
    }

    fail(span: SpanLike | null, error: Error, details: SpanFailureDetails = {}): void {
        if (!span) return;
        span.recordException?.(error);
        span.setAttribute('error.type', error.name);
        if (isNeutrxError(error)) {
            span.setAttribute('neutrx.error.category', error.category);
            span.setAttribute('neutrx.error.retryable', error.retryable);
            if (error.requestId) span.setAttribute('neutrx.request.id', error.requestId);
            const phase = (error as { readonly phase?: unknown }).phase;
            if (typeof phase === 'string') span.setAttribute('neutrx.error.phase', phase);
        }
        if (details.retries !== undefined) span.setAttribute('neutrx.retry.count', details.retries);
        if (details.durationMs !== undefined) span.setAttribute('neutrx.request.duration_ms', details.durationMs);
        setOptionalAttribute(span, 'neutrx.circuit_breaker.state', details.circuitState);
        const code = (error as { readonly code?: unknown }).code;
        if (typeof code === 'string') span.setAttribute('neutrx.error.code', code);
        span.setStatus?.({ code: this.#errorStatusCode(), message: error.message });
        this.#end(span);
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

    #end(span: SpanLike): void {
        if (this.#ended.has(span)) return;
        this.#ended.add(span);
        span.end();
    }
}

function requestAttributes(config: InternalRequestConfig): Record<string, AttributeValue> {
    const url = new URL(config.url);
    const attributes: Record<string, AttributeValue> = {
        'http.request.method': config.method,
        'http.target': url.pathname,
        'url.scheme': url.protocol.slice(0, -1),
        'url.path': url.pathname,
        'server.address': url.hostname,
        'server.port': portFor(url),
        'network.protocol.name': 'http',
        'network.protocol.version': protocolVersion(config),
        'neutrx.request.id': config.requestId,
        'neutrx.request.timeout_ms': config.timeout,
        'neutrx.request.redirect.max': config.maxRedirects,
        'neutrx.retry.count': 0,
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
    if (typeof value === 'string') {
        return typeof Buffer !== 'undefined'
            ? Buffer.byteLength(value)
            : new TextEncoder().encode(value).byteLength;
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value.byteLength;
    if (value instanceof Uint8Array) return value.byteLength;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size;
    return undefined;
}

function setOptionalAttribute(span: SpanLike, name: string, value: AttributeValue | undefined): void {
    if (value !== undefined) span.setAttribute(name, value);
}

function traceContextFromSpan(span: SpanLike | null): TraceContext | undefined {
    const context = span?.spanContext?.();
    if (!context || !validTraceId(context.traceId) || !validSpanId(context.spanId)) return undefined;
    return {
        traceId: context.traceId.toLowerCase(),
        spanId: context.spanId.toLowerCase(),
        sampled: (context.traceFlags & 1) === 1,
    };
}

function traceContextFromCarrier(carrier: Record<string, string>): TraceContext | undefined {
    return traceContextFromTraceparent(carrier.traceparent, carrier.tracestate);
}

function traceContextFromTraceparent(traceparent: string | undefined, tracestate?: string): TraceContext | undefined {
    const parts = traceparent?.split('-');
    const traceId = parts?.[1];
    const spanId = parts?.[2];
    const flags = parts?.[3];
    if (!traceId || !spanId || !flags || !validTraceId(traceId) || !validSpanId(spanId)) return undefined;
    return {
        traceId: traceId.toLowerCase(),
        spanId: spanId.toLowerCase(),
        sampled: (Number.parseInt(flags, 16) & 1) === 1,
        ...(tracestate ? { tracestate } : {}),
    };
}

function validTraceId(value: string): boolean {
    return /^[0-9a-f]{32}$/iu.test(value) && !/^0+$/u.test(value);
}

function validSpanId(value: string): boolean {
    return /^[0-9a-f]{16}$/iu.test(value) && !/^0+$/u.test(value);
}

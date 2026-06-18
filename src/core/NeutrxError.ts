import type { Headers, NeutrxErrorCategory, NeutrxResponse, TraceContext, ValidationIssue } from '../types.js';

const REDACTION = '[REDACTED]';
const SENSITIVE_KEY_RE = /(?:^|[-_.])(authorization|cookie|set-cookie|proxy-authorization|token|access-token|refresh-token|secret|password|passwd|api-key|apikey|client-secret|idempotency-key)(?:$|[-_.])/i;

export interface NeutrxErrorOptions {
    readonly code?: string;
    readonly category?: NeutrxErrorCategory;
    readonly requestId?: string | null;
    readonly url?: string | null;
    readonly method?: string | null;
    readonly retryable?: boolean;
    readonly context?: Record<string, string | number | boolean | null | undefined>;
    readonly traceContext?: TraceContext;
    readonly cause?: unknown;
    readonly errno?: string | number | null;
    readonly syscall?: string | null;
    readonly timeout?: number;
    readonly phase?: string;
    readonly severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    /** Custom timeout message (axios `timeoutErrorMessage` parity). Overrides the default phrasing. */
    readonly timeoutErrorMessage?: string;
    /** Extra property/header keys to mask in {@link NeutrxError.toJSON} (axios `redact` parity). */
    readonly redact?: readonly string[];
}

export function axiosTimeoutErrorCode(transitional?: { readonly clarifyTimeoutError?: boolean }): 'ECONNABORTED' | 'ETIMEDOUT' {
    return transitional?.clarifyTimeoutError ? 'ETIMEDOUT' : 'ECONNABORTED';
}

export class NeutrxError extends Error {
    readonly __isNeutrxError!: true;
    code: string;
    category: NeutrxErrorCategory;
    timestamp: string;
    requestId: string | null;
    url: string | null;
    method: string | null;
    retryable: boolean;
    context: Record<string, string | number | boolean | null | undefined>;
    traceContext?: TraceContext;
    duration?: number;
    /** Extra keys to mask in {@link toJSON}, sourced from request config `redact`. */
    redact?: readonly string[];

    constructor(message: string, options: NeutrxErrorOptions = {}) {
        super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = this.constructor.name;
        this.code = options.code ?? 'NEUTRX_ERROR';
        this.category = options.category ?? 'unknown';
        this.timestamp = new Date().toISOString();
        this.requestId = options.requestId ?? null;
        this.url = options.url ?? null;
        this.method = options.method ?? null;
        this.retryable = options.retryable ?? false;
        this.context = options.context ?? {};
        if (options.traceContext) this.traceContext = options.traceContext;
        if (options.redact && options.redact.length > 0) this.redact = options.redact;
        Object.defineProperty(this, '__isNeutrxError', {
            value: true,
            enumerable: false,
            configurable: false,
            writable: false,
        });

        if (isProduction()) {
            this.stack = `${this.name}: ${message}`;
        } else {
            Error.captureStackTrace?.(this, this.constructor);
        }
    }

    toJSON(): Record<string, unknown> {
        return {
            name: this.name,
            code: this.code,
            category: this.category,
            message: redactText(this.message, this.redact),
            timestamp: this.timestamp,
            requestId: this.requestId,
            url: this.url ? redactUrl(this.url, this.redact) : null,
            method: this.method,
            retryable: this.retryable,
            duration: this.duration,
            traceId: this.traceContext?.traceId ?? null,
            spanId: this.traceContext?.spanId ?? null,
            context: redactUnknown(this.context, 0, this.redact),
            ...(this.cause !== undefined ? { cause: serializeCause(this.cause) } : {}),
        };
    }

    override toString(): string {
        return `[${this.name}] ${this.code}: ${redactText(this.message, this.redact)}`;
    }
}

export function isNeutrxError(error: unknown): error is NeutrxError {
    return Boolean(
        error
        && typeof error === 'object'
        && (error as { readonly __isNeutrxError?: unknown }).__isNeutrxError === true
    );
}

export function toStructuredError(error: unknown): Record<string, unknown> {
    if (isNeutrxError(error)) return error.toJSON();
    if (error instanceof Error) {
        const details = error as Error & {
            readonly code?: unknown;
            readonly requestId?: unknown;
            readonly url?: unknown;
            readonly method?: unknown;
            readonly duration?: unknown;
            readonly retryable?: unknown;
            readonly traceContext?: TraceContext;
        };
        return {
            name: error.name,
            code: typeof details.code === 'string' ? details.code : 'UNKNOWN',
            category: inferErrorCategory(error),
            message: redactText(error.message),
            requestId: typeof details.requestId === 'string' ? details.requestId : null,
            url: typeof details.url === 'string' ? redactUrl(details.url) : null,
            method: typeof details.method === 'string' ? details.method : null,
            retryable: details.retryable === true,
            duration: typeof details.duration === 'number' ? details.duration : undefined,
            traceId: details.traceContext?.traceId ?? null,
            spanId: details.traceContext?.spanId ?? null,
            ...(error.cause !== undefined ? { cause: serializeCause(error.cause) } : {}),
        };
    }
    return {
        name: 'UnknownError',
        code: 'UNKNOWN',
        category: 'unknown',
        message: redactText(String(error)),
        retryable: false,
    };
}

export class NeutrxNetworkError extends NeutrxError {
    errno: string | number | null;
    syscall: string | null;

    constructor(message: string, options: NeutrxErrorOptions = {}) {
        super(message, { ...options, code: options.code ?? 'NETWORK_ERROR', category: options.category ?? 'network', retryable: true });
        this.errno = options.errno ?? null;
        this.syscall = options.syscall ?? null;
    }

    override toJSON(): Record<string, unknown> {
        return {
            ...super.toJSON(),
            errno: this.errno,
            syscall: this.syscall,
        };
    }
}

export class NeutrxConnectionRefusedError extends NeutrxNetworkError {
    constructor(url: string, options: NeutrxErrorOptions = {}) {
        super(`Connection refused: ${url}`, { ...options, code: 'ECONNREFUSED' });
    }
}

export class NeutrxDNSError extends NeutrxNetworkError {
    hostname: string;

    constructor(hostname: string, options: NeutrxErrorOptions = {}) {
        super(`DNS resolution failed: ${hostname}`, { ...options, code: 'ENOTFOUND' });
        this.hostname = hostname;
    }

    override toJSON(): Record<string, unknown> {
        return {
            ...super.toJSON(),
            hostname: this.hostname,
        };
    }
}

export class NeutrxTimeoutError extends NeutrxError {
    timeout: number | null;
    phase: string;

    constructor(message: string, options: NeutrxErrorOptions = {}) {
        super(message, { ...options, code: options.code ?? 'TIMEOUT', category: options.category ?? 'timeout', retryable: true });
        this.timeout = options.timeout ?? null;
        this.phase = options.phase ?? 'request';
    }

    override toJSON(): Record<string, unknown> {
        return {
            ...super.toJSON(),
            timeout: this.timeout,
            phase: this.phase,
        };
    }
}

export class NeutrxConnectTimeoutError extends NeutrxTimeoutError {
    constructor(url: string, timeout: number, options: NeutrxErrorOptions = {}) {
        super(options.timeoutErrorMessage ?? `Connect timeout after ${timeout}ms: ${url}`, {
            ...options,
            code: options.code ?? 'CONNECT_TIMEOUT',
            timeout,
            phase: 'connect',
        });
    }
}

export class NeutrxResponseTimeoutError extends NeutrxTimeoutError {
    constructor(url: string, timeout: number, options: NeutrxErrorOptions = {}) {
        super(options.timeoutErrorMessage ?? `Response timeout after ${timeout}ms: ${url}`, {
            ...options,
            code: options.code ?? 'RESPONSE_TIMEOUT',
            timeout,
            phase: 'response',
        });
    }
}

export class NeutrxSecurityError extends NeutrxError {
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

    constructor(message: string, options: NeutrxErrorOptions = {}) {
        super(message, { ...options, code: options.code ?? 'SECURITY_VIOLATION', category: options.category ?? 'security', retryable: false });
        this.severity = options.severity ?? 'HIGH';
    }

    override toJSON(): Record<string, unknown> {
        return {
            ...super.toJSON(),
            severity: this.severity,
        };
    }
}

export class NeutrxSSRFError extends NeutrxSecurityError {
    blockedURL: string;
    reason: string;

    constructor(url: string, reason: string, options: NeutrxErrorOptions = {}) {
        super(`SSRF blocked: ${reason} -> ${url}`, {
            ...options,
            code: 'SSRF_BLOCKED',
            severity: 'CRITICAL',
        });
        this.blockedURL = url;
        this.reason = reason;
    }

    override toJSON(): Record<string, unknown> {
        return {
            ...super.toJSON(),
            blockedURL: redactUrl(this.blockedURL),
            reason: redactText(this.reason),
        };
    }
}

export class NeutrxCertPinError extends NeutrxSecurityError {
    hostname: string;

    constructor(hostname: string, options: NeutrxErrorOptions = {}) {
        super(`Certificate pin mismatch: ${hostname}`, {
            ...options,
            code: 'CERT_PIN_MISMATCH',
            severity: 'CRITICAL',
        });
        this.hostname = hostname;
    }

    override toJSON(): Record<string, unknown> {
        return {
            ...super.toJSON(),
            hostname: this.hostname,
        };
    }
}

export class NeutrxInjectionError extends NeutrxSecurityError {
    injectionType: string;
    location: string;

    constructor(type: string, location: string, options: NeutrxErrorOptions = {}) {
        super(`${type} injection detected in ${location}`, {
            ...options,
            code: 'INJECTION_DETECTED',
            severity: 'CRITICAL',
        });
        this.injectionType = type;
        this.location = location;
    }

    override toJSON(): Record<string, unknown> {
        return {
            ...super.toJSON(),
            injectionType: this.injectionType,
            location: this.location,
        };
    }
}

export class NeutrxPrototypePollutionError extends NeutrxSecurityError {
    constructor(key: string, options: NeutrxErrorOptions = {}) {
        super(`Prototype pollution attempt: ${key}`, {
            ...options,
            code: 'PROTOTYPE_POLLUTION',
            severity: 'CRITICAL',
        });
    }
}

export class NeutrxRateLimitError extends NeutrxSecurityError {
    domain: string;

    constructor(domain: string, options: NeutrxErrorOptions = {}) {
        super(`Rate limit exceeded: ${domain}`, {
            ...options,
            code: 'RATE_LIMIT_EXCEEDED',
            severity: 'MEDIUM',
            retryable: true,
        });
        this.domain = domain;
        this.retryable = true;
    }

    override toJSON(): Record<string, unknown> {
        return {
            ...super.toJSON(),
            domain: this.domain,
        };
    }
}

export class NeutrxHTTPError extends NeutrxError {
    status: number;
    statusText: string;
    response: NeutrxResponse;
    data: NeutrxResponse['data'];
    headers: Headers;
    retryAfter: HeaderValueAsString | null;

    constructor(response: NeutrxResponse, options: NeutrxErrorOptions = {}) {
        const traceContext = options.traceContext ?? response.traceContext ?? response.config.traceContext;
        super(
            `HTTP ${response.status} ${response.statusText}: ${response.config.url}`,
            {
                ...options,
                code: `HTTP_${response.status}`,
                category: options.category ?? 'http',
                requestId: options.requestId ?? response.requestId,
                url: response.config.url,
                method: response.config.method,
                ...(traceContext ? { traceContext } : {}),
                ...(options.redact ?? response.config.redact ? { redact: options.redact ?? response.config.redact } : {}),
            }
        );
        this.status = response.status;
        this.statusText = response.statusText;
        this.response = response;
        this.data = response.data;
        this.headers = response.headers;
        this.retryAfter = headerToString(response.headers['retry-after']);
    }

    override toJSON(): Record<string, unknown> {
        return {
            ...super.toJSON(),
            status: this.status,
            statusText: this.statusText,
            retryAfter: this.retryAfter,
            response: {
                status: this.status,
                statusText: this.statusText,
                headers: redactHeaders(this.headers, this.redact),
                data: redactUnknown(this.data, 0, this.redact),
            },
        };
    }
}

export class NeutrxClientError extends NeutrxHTTPError {
    constructor(response: NeutrxResponse, options: NeutrxErrorOptions = {}) {
        super(response, options);
        this.retryable = response.status === 408 || response.status === 429;
    }
}

export class NeutrxServerError extends NeutrxHTTPError {
    constructor(response: NeutrxResponse, options: NeutrxErrorOptions = {}) {
        super(response, options);
        this.retryable = [500, 502, 503, 504].includes(response.status);
    }
}

export class NeutrxCircuitBreakerError extends NeutrxError {
    retryAfter: number;

    constructor(url: string, retryAfterMs: number, options: NeutrxErrorOptions = {}) {
        super(`Circuit open for ${url}. Retry after ${retryAfterMs}ms`, {
            ...options,
            code: 'CIRCUIT_OPEN',
            category: options.category ?? 'resilience',
            retryable: false,
        });
        this.retryAfter = retryAfterMs;
    }

    override toJSON(): Record<string, unknown> {
        return {
            ...super.toJSON(),
            retryAfter: this.retryAfter,
        };
    }
}

export class NeutrxMaxRetriesError extends NeutrxError {
    attempts: number;
    lastError: Error;

    constructor(url: string | undefined, attempts: number, lastError: Error, options: NeutrxErrorOptions = {}) {
        super(`Max retries (${attempts}) exceeded: ${url ?? 'unknown URL'}`, {
            ...options,
            code: 'MAX_RETRIES_EXCEEDED',
            category: options.category ?? 'resilience',
            retryable: false,
            cause: options.cause ?? lastError,
        });
        this.attempts = attempts;
        this.lastError = lastError;
    }

    override toJSON(): Record<string, unknown> {
        return {
            ...super.toJSON(),
            attempts: this.attempts,
            lastError: serializeNestedError(this.lastError),
        };
    }
}

export class NeutrxBulkheadError extends NeutrxError {
    limit: number;

    constructor(domain: string, limit: number, options: NeutrxErrorOptions = {}) {
        super(`Bulkhead limit (${limit}) reached: ${domain}`, {
            ...options,
            code: 'BULKHEAD_FULL',
            category: options.category ?? 'resilience',
            retryable: true,
        });
        this.limit = limit;
    }

    override toJSON(): Record<string, unknown> {
        return {
            ...super.toJSON(),
            limit: this.limit,
        };
    }
}

export class NeutrxResponseSizeError extends NeutrxError {
    size: number;
    limit: number;

    constructor(size: number, limit: number, options: NeutrxErrorOptions = {}) {
        super(`Response size ${size}b exceeds limit ${limit}b`, {
            ...options,
            code: 'RESPONSE_TOO_LARGE',
            category: options.category ?? 'limits',
            retryable: false,
        });
        this.size = size;
        this.limit = limit;
    }

    override toJSON(): Record<string, unknown> {
        return {
            ...super.toJSON(),
            size: this.size,
            limit: this.limit,
        };
    }
}

export class NeutrxRequestSizeError extends NeutrxError {
    size: number;
    limit: number;

    constructor(size: number, limit: number, options: NeutrxErrorOptions = {}) {
        super(`Request body size ${size}b exceeds limit ${limit}b`, {
            ...options,
            code: 'REQUEST_TOO_LARGE',
            category: options.category ?? 'limits',
            retryable: false,
        });
        this.size = size;
        this.limit = limit;
    }

    override toJSON(): Record<string, unknown> {
        return {
            ...super.toJSON(),
            size: this.size,
            limit: this.limit,
        };
    }
}

export class NeutrxValidationError extends NeutrxError {
    phase: 'request' | 'response';
    issues: readonly ValidationIssue[];

    constructor(phase: 'request' | 'response', issues: readonly ValidationIssue[], options: NeutrxErrorOptions = {}) {
        const summary = summarizeIssues(issues);
        super(`${capitalize(phase)} validation failed${summary ? `: ${summary}` : ''}`, {
            ...options,
            code: phase === 'request' ? 'REQUEST_VALIDATION_FAILED' : 'RESPONSE_VALIDATION_FAILED',
            category: options.category ?? 'validation',
            retryable: false,
            context: {
                ...options.context,
                phase,
                issueCount: issues.length,
            },
        });
        this.phase = phase;
        this.issues = issues;
    }

    override toJSON(): Record<string, unknown> {
        return {
            ...super.toJSON(),
            phase: this.phase,
            issues: this.issues.map(issue => ({
                ...(issue.path ? { path: [...issue.path] } : {}),
                message: redactText(issue.message),
                ...(issue.code ? { code: issue.code } : {}),
            })),
        };
    }
}

export interface NodeLikeError extends Error {
    readonly code?: string;
    readonly errno?: string | number;
    readonly syscall?: string;
}

type HeaderValueAsString = string;

export class NeutrxErrorFactory {
    static fromNodeError(
        nodeError: NodeLikeError,
        config: { readonly url?: string; readonly method?: string; readonly redact?: readonly string[]; readonly timeoutErrorMessage?: string } = {}
    ): NeutrxError {
        const opts: NeutrxErrorOptions = {
            ...(config.url ? { url: config.url } : {}),
            ...(config.method ? { method: config.method } : {}),
            ...(config.redact ? { redact: config.redact } : {}),
            ...(config.timeoutErrorMessage ? { timeoutErrorMessage: config.timeoutErrorMessage } : {}),
            context: { errno: nodeError.errno, syscall: nodeError.syscall },
            errno: nodeError.errno ?? null,
            syscall: nodeError.syscall ?? null,
            cause: nodeError,
        };

        switch (nodeError.code) {
            case 'ECONNREFUSED':
                return new NeutrxConnectionRefusedError(config.url ?? 'unknown URL', opts);
            case 'ENOTFOUND':
                return new NeutrxDNSError(NeutrxErrorFactory.#safeHostname(config.url), opts);
            case 'ETIMEDOUT':
                return new NeutrxTimeoutError(config.timeoutErrorMessage ?? nodeError.message, opts);
            case 'ECONNRESET':
                return new NeutrxNetworkError('Connection reset', { ...opts, code: 'ECONNRESET' });
            case 'ENETUNREACH':
                return new NeutrxNetworkError('Network unreachable', { ...opts, code: 'ENETUNREACH' });
            case 'CERT_HAS_EXPIRED':
                return new NeutrxSecurityError('Certificate expired', { ...opts, code: 'CERT_EXPIRED' });
            case 'DEPTH_ZERO_SELF_SIGNED_CERT':
                return new NeutrxSecurityError('Self-signed certificate', { ...opts, code: 'SELF_SIGNED' });
            default:
                return new NeutrxNetworkError(nodeError.message, { ...opts, code: nodeError.code ?? 'NETWORK_ERROR' });
        }
    }

    static fromHTTPStatus(response: NeutrxResponse): NeutrxHTTPError {
        if (response.status >= 400 && response.status < 500) return new NeutrxClientError(response);
        if (response.status >= 500) return new NeutrxServerError(response);
        return new NeutrxHTTPError(response);
    }

    static #safeHostname(url?: string): string {
        if (!url) return 'unknown-host';
        try {
            return new URL(url).hostname;
        } catch {
            return url;
        }
    }
}

function headerToString(value: Headers[string] | undefined): string | null {
    if (value == null) return null;
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
}

function isProduction(): boolean {
    return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
}

function redactHeaders(headers: Headers, extra?: readonly string[]): Headers {
    const result: Headers = {};
    for (const [key, value] of Object.entries(headers)) {
        result[key] = isSensitiveKey(key, extra)
            ? Array.isArray(value) ? value.map(() => REDACTION) : REDACTION
            : value;
    }
    return result;
}

function redactUnknown(value: unknown, depth = 0, extra?: readonly string[]): unknown {
    if (depth > 5) return '[Truncated]';
    if (typeof value === 'string') return redactText(value, extra);
    if (value === null || typeof value !== 'object') return value;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return `[Buffer:${value.length}]`;
    if (value instanceof ArrayBuffer) return `[ArrayBuffer:${value.byteLength}]`;
    if (ArrayBuffer.isView(value)) return `[TypedArray:${value.byteLength}]`;
    if (Array.isArray(value)) return value.map(item => redactUnknown(item, depth + 1, extra));

    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
        result[key] = isSensitiveKey(key, extra) ? REDACTION : redactUnknown(child, depth + 1, extra);
    }
    return result;
}

function redactText(value: string, extra?: readonly string[]): string {
    const redacted = value.replace(/([?&](?:access_token|refresh_token|token|api_key|apikey|password|secret|client_secret)=)[^&\s]+/gi, `$1${REDACTION}`);
    if (!extra || extra.length === 0) return redacted;
    return extra.reduce<string>((current, key) => {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return current.replace(new RegExp(`([?&]${escaped}=)[^&\\s]+`, 'gi'), `$1${REDACTION}`);
    }, redacted);
}

function redactUrl(value: string, extra?: readonly string[]): string {
    try {
        const parsed = new URL(value);
        if (parsed.username) parsed.username = REDACTION;
        if (parsed.password) parsed.password = REDACTION;
        for (const key of [...parsed.searchParams.keys()]) {
            if (isSensitiveKey(key, extra)) parsed.searchParams.set(key, REDACTION);
        }
        return parsed.toString().replace(new RegExp(encodeURIComponent(REDACTION), 'g'), REDACTION);
    } catch {
        return redactText(value, extra);
    }
}

function isSensitiveKey(key: string, extra?: readonly string[]): boolean {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEY_RE.test(lower)) return true;
    return extra ? extra.some(entry => entry.toLowerCase() === lower) : false;
}

function serializeNestedError(error: Error): Record<string, unknown> {
    const maybeCode = (error as { readonly code?: unknown }).code;
    return {
        name: error.name,
        message: redactText(error.message),
        ...(typeof maybeCode === 'string' || typeof maybeCode === 'number' ? { code: maybeCode } : {}),
        ...(isNeutrxError(error) ? {
            category: error.category,
            requestId: error.requestId,
            retryable: error.retryable,
            traceId: error.traceContext?.traceId ?? null,
            spanId: error.traceContext?.spanId ?? null,
        } : {}),
    };
}

function serializeCause(cause: unknown): unknown {
    if (cause instanceof Error) return serializeNestedError(cause);
    return redactUnknown(cause);
}

function inferErrorCategory(error: Error): NeutrxErrorCategory {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === 'string') {
        if (code === 'ETIMEDOUT' || code === 'ECONNABORTED' || code.includes('TIMEOUT')) return 'timeout';
        if (/^(?:EAI_|EADDR|ECONN|EHOST|ENET|ENOTFOUND|EPIPE|ERR_NETWORK)/u.test(code)) return 'network';
    }
    return 'unknown';
}

function summarizeIssues(issues: readonly ValidationIssue[]): string {
    return issues.slice(0, 3).map(issue => {
        const path = issue.path?.length ? `${issue.path.join('.')}: ` : '';
        return `${path}${issue.message}`;
    }).join('; ');
}

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

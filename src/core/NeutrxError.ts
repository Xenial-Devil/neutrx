import type { Headers, NeutrxResponse, ValidationIssue } from '../types.js';

const REDACTION = '[REDACTED]';
const SENSITIVE_KEY_RE = /(?:^|[-_.])(authorization|cookie|set-cookie|proxy-authorization|token|access-token|refresh-token|secret|password|passwd|api-key|apikey|client-secret|idempotency-key)(?:$|[-_.])/i;

export interface NeutrxErrorOptions {
    readonly code?: string;
    readonly requestId?: string | null;
    readonly url?: string | null;
    readonly method?: string | null;
    readonly retryable?: boolean;
    readonly context?: Record<string, string | number | boolean | null | undefined>;
    readonly errno?: string | number | null;
    readonly syscall?: string | null;
    readonly timeout?: number;
    readonly phase?: string;
    readonly severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export class NeutrxError extends Error {
    readonly __isNeutrxError!: true;
    code: string;
    timestamp: string;
    requestId: string | null;
    url: string | null;
    method: string | null;
    retryable: boolean;
    context: Record<string, string | number | boolean | null | undefined>;
    duration?: number;

    constructor(message: string, options: NeutrxErrorOptions = {}) {
        super(message);
        this.name = this.constructor.name;
        this.code = options.code ?? 'NEUTRX_ERROR';
        this.timestamp = new Date().toISOString();
        this.requestId = options.requestId ?? null;
        this.url = options.url ?? null;
        this.method = options.method ?? null;
        this.retryable = options.retryable ?? false;
        this.context = options.context ?? {};
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
            message: redactText(this.message),
            timestamp: this.timestamp,
            requestId: this.requestId,
            url: this.url ? redactUrl(this.url) : null,
            method: this.method,
            retryable: this.retryable,
            duration: this.duration,
            context: redactUnknown(this.context),
        };
    }

    override toString(): string {
        return `[${this.name}] ${this.code}: ${redactText(this.message)}`;
    }
}

export function isNeutrxError(error: unknown): error is NeutrxError {
    return Boolean(
        error
        && typeof error === 'object'
        && (error as { readonly __isNeutrxError?: unknown }).__isNeutrxError === true
    );
}

export class NeutrxNetworkError extends NeutrxError {
    errno: string | number | null;
    syscall: string | null;

    constructor(message: string, options: NeutrxErrorOptions = {}) {
        super(message, { ...options, code: options.code ?? 'NETWORK_ERROR', retryable: true });
        this.errno = options.errno ?? null;
        this.syscall = options.syscall ?? null;
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
}

export class NeutrxTimeoutError extends NeutrxError {
    timeout: number | null;
    phase: string;

    constructor(message: string, options: NeutrxErrorOptions = {}) {
        super(message, { ...options, code: options.code ?? 'TIMEOUT', retryable: true });
        this.timeout = options.timeout ?? null;
        this.phase = options.phase ?? 'request';
    }
}

export class NeutrxConnectTimeoutError extends NeutrxTimeoutError {
    constructor(url: string, timeout: number, options: NeutrxErrorOptions = {}) {
        super(`Connect timeout after ${timeout}ms: ${url}`, {
            ...options,
            code: 'CONNECT_TIMEOUT',
            timeout,
            phase: 'connect',
        });
    }
}

export class NeutrxResponseTimeoutError extends NeutrxTimeoutError {
    constructor(url: string, timeout: number, options: NeutrxErrorOptions = {}) {
        super(`Response timeout after ${timeout}ms: ${url}`, {
            ...options,
            code: 'RESPONSE_TIMEOUT',
            timeout,
            phase: 'response',
        });
    }
}

export class NeutrxSecurityError extends NeutrxError {
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

    constructor(message: string, options: NeutrxErrorOptions = {}) {
        super(message, { ...options, code: options.code ?? 'SECURITY_VIOLATION', retryable: false });
        this.severity = options.severity ?? 'HIGH';
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
}

export class NeutrxHTTPError extends NeutrxError {
    status: number;
    statusText: string;
    response: NeutrxResponse;
    data: NeutrxResponse['data'];
    headers: Headers;
    retryAfter: HeaderValueAsString | null;

    constructor(response: NeutrxResponse, options: NeutrxErrorOptions = {}) {
        super(
            `HTTP ${response.status} ${response.statusText}: ${response.config.url}`,
            { ...options, code: `HTTP_${response.status}`, url: response.config.url, method: response.config.method }
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
                headers: redactHeaders(this.headers),
                data: redactUnknown(this.data),
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
            retryable: false,
        });
        this.retryAfter = retryAfterMs;
    }
}

export class NeutrxMaxRetriesError extends NeutrxError {
    attempts: number;
    lastError: Error;

    constructor(url: string | undefined, attempts: number, lastError: Error, options: NeutrxErrorOptions = {}) {
        super(`Max retries (${attempts}) exceeded: ${url ?? 'unknown URL'}`, {
            ...options,
            code: 'MAX_RETRIES_EXCEEDED',
            retryable: false,
        });
        this.attempts = attempts;
        this.lastError = lastError;
    }
}

export class NeutrxBulkheadError extends NeutrxError {
    limit: number;

    constructor(domain: string, limit: number, options: NeutrxErrorOptions = {}) {
        super(`Bulkhead limit (${limit}) reached: ${domain}`, {
            ...options,
            code: 'BULKHEAD_FULL',
            retryable: true,
        });
        this.limit = limit;
    }
}

export class NeutrxResponseSizeError extends NeutrxError {
    size: number;
    limit: number;

    constructor(size: number, limit: number, options: NeutrxErrorOptions = {}) {
        super(`Response size ${size}b exceeds limit ${limit}b`, {
            ...options,
            code: 'RESPONSE_TOO_LARGE',
            retryable: false,
        });
        this.size = size;
        this.limit = limit;
    }
}

export class NeutrxRequestSizeError extends NeutrxError {
    size: number;
    limit: number;

    constructor(size: number, limit: number, options: NeutrxErrorOptions = {}) {
        super(`Request body size ${size}b exceeds limit ${limit}b`, {
            ...options,
            code: 'REQUEST_TOO_LARGE',
            retryable: false,
        });
        this.size = size;
        this.limit = limit;
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
    static fromNodeError(nodeError: NodeLikeError, config: { readonly url?: string; readonly method?: string } = {}): NeutrxError {
        const opts: NeutrxErrorOptions = {
            ...(config.url ? { url: config.url } : {}),
            ...(config.method ? { method: config.method } : {}),
            context: { errno: nodeError.errno, syscall: nodeError.syscall },
            errno: nodeError.errno ?? null,
            syscall: nodeError.syscall ?? null,
        };

        switch (nodeError.code) {
            case 'ECONNREFUSED':
                return new NeutrxConnectionRefusedError(config.url ?? 'unknown URL', opts);
            case 'ENOTFOUND':
                return new NeutrxDNSError(NeutrxErrorFactory.#safeHostname(config.url), opts);
            case 'ETIMEDOUT':
                return new NeutrxTimeoutError(nodeError.message, opts);
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

function redactHeaders(headers: Headers): Headers {
    const result: Headers = {};
    for (const [key, value] of Object.entries(headers)) {
        result[key] = isSensitiveKey(key)
            ? Array.isArray(value) ? value.map(() => REDACTION) : REDACTION
            : value;
    }
    return result;
}

function redactUnknown(value: unknown, depth = 0): unknown {
    if (depth > 5) return '[Truncated]';
    if (typeof value === 'string') return redactText(value);
    if (value === null || typeof value !== 'object') return value;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return `[Buffer:${value.length}]`;
    if (value instanceof ArrayBuffer) return `[ArrayBuffer:${value.byteLength}]`;
    if (ArrayBuffer.isView(value)) return `[TypedArray:${value.byteLength}]`;
    if (Array.isArray(value)) return value.map(item => redactUnknown(item, depth + 1));

    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
        result[key] = isSensitiveKey(key) ? REDACTION : redactUnknown(child, depth + 1);
    }
    return result;
}

function redactText(value: string): string {
    return value.replace(/([?&](?:access_token|refresh_token|token|api_key|apikey|password|secret|client_secret)=)[^&\s]+/gi, `$1${REDACTION}`);
}

function redactUrl(value: string): string {
    try {
        const parsed = new URL(value);
        if (parsed.username) parsed.username = REDACTION;
        if (parsed.password) parsed.password = REDACTION;
        for (const key of [...parsed.searchParams.keys()]) {
            if (isSensitiveKey(key)) parsed.searchParams.set(key, REDACTION);
        }
        return parsed.toString();
    } catch {
        return redactText(value);
    }
}

function isSensitiveKey(key: string): boolean {
    return SENSITIVE_KEY_RE.test(key.toLowerCase());
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

import { NeutrxSecurityError } from './NeutrxError.js';
import { NeutrxHeaders } from './headers.js';
import { normalizeSecurityProfile } from '../security/profiles.js';
import type {
    ClientConfig,
    Headers,
    HttpMethod,
    InternalHeaders,
    InternalRequestConfig,
    NormalizedClientConfig,
    ParsedResponseData,
    QueryParams,
    QueryValue,
    RequestAdapterName,
    RequestBody,
    RequestConfig,
    ServiceDiscoveryConfig,
    ServiceEndpoint,
    TransformRequest,
    TransformResponse,
} from '../types.js';

const DEFAULT_SERVICE_ENDPOINT_LIMIT = 100;
const MAX_SERVICE_ENDPOINT_WEIGHT = 100;

export interface ServiceDiscoveryState {
    readonly counters: Map<string, number>;
}

export function buildConfig(custom: ClientConfig): NormalizedClientConfig {
    const securityProfile = normalizeSecurityProfile(custom.security?.profile);
    const securityDefaults = securityProfileDefaults(securityProfile);

    return {
        allowAbsoluteUrls: custom.allowAbsoluteUrls ?? true,
        timeout: custom.timeout ?? 30_000,
        connectTimeout: custom.connectTimeout ?? 10_000,
        maxRedirects: custom.maxRedirects ?? 5,
        maxContentLength: custom.maxContentLength ?? 52_428_800,
        maxBodyLength: custom.maxBodyLength ?? (securityProfile === 'legacy' ? Number.POSITIVE_INFINITY : 10_485_760),
        responseEncoding: custom.responseEncoding ?? 'utf8',
        validateStatus: custom.validateStatus ?? ((status: number): boolean => status >= 200 && status < 300),
        ...(custom.baseURL ? { baseURL: custom.baseURL } : {}),
        ...(custom.headers ? { headers: NeutrxHeaders.from(custom.headers) } : {}),
        ...(custom.auth ? { auth: custom.auth } : {}),
        ...(custom.idempotencyKey !== undefined ? { idempotencyKey: custom.idempotencyKey } : {}),
        ...(custom.idempotencyKeyHeader ? { idempotencyKeyHeader: custom.idempotencyKeyHeader } : {}),
        ...(custom.paramsSerializer ? { paramsSerializer: custom.paramsSerializer } : {}),
        ...(custom.formSerializer ? { formSerializer: custom.formSerializer } : {}),
        ...(custom.transformRequest ? { transformRequest: normalizeArray(custom.transformRequest) } : {}),
        ...(custom.transformResponse ? { transformResponse: normalizeArray(custom.transformResponse) } : {}),
        ...(custom.parseJson ? { parseJson: custom.parseJson } : {}),
        ...(custom.stringifyJson ? { stringifyJson: custom.stringifyJson } : {}),
        throwHttpErrors: custom.throwHttpErrors ?? true,
        ...(custom.adapter ? { adapter: custom.adapter } : {}),
        ...(custom.proxy !== undefined ? { proxy: custom.proxy } : {}),
        ...(custom.httpAgent ? { httpAgent: custom.httpAgent } : {}),
        ...(custom.httpsAgent ? { httpsAgent: custom.httpsAgent } : {}),
        ...(custom.lookup ? { lookup: custom.lookup } : {}),
        ...(custom.socketPath ? { socketPath: custom.socketPath } : {}),
        ...(custom.maxRate !== undefined ? { maxRate: custom.maxRate } : {}),
        ...(custom.fetch ? { fetch: custom.fetch } : {}),
        ...(custom.httpVersion ? { httpVersion: custom.httpVersion } : {}),
        ...(custom.http2Options ? { http2Options: custom.http2Options } : {}),
        ...(custom.serviceDiscovery ? { serviceDiscovery: custom.serviceDiscovery } : {}),
        ...(custom.withCredentials !== undefined ? { withCredentials: custom.withCredentials } : {}),
        ...(custom.credentials ? { credentials: custom.credentials } : {}),
        ...(custom.xsrfCookieName !== undefined ? { xsrfCookieName: custom.xsrfCookieName } : {}),
        ...(custom.xsrfHeaderName !== undefined ? { xsrfHeaderName: custom.xsrfHeaderName } : {}),
        ...(custom.withXSRFToken !== undefined ? { withXSRFToken: custom.withXSRFToken } : {}),
        ...(custom.instrumentation ? { instrumentation: custom.instrumentation } : {}),
        decompress: custom.decompress ?? true,
        ...(custom.tls ? { tls: custom.tls } : {}),
        ...(custom.beforeRedirect ? { beforeRedirect: custom.beforeRedirect } : {}),
        transitional: {
            clarifyTimeoutError: custom.transitional?.clarifyTimeoutError ?? false,
        },
        security: {
            profile: securityProfile,
            enforceHTTPS: custom.security?.enforceHTTPS ?? securityDefaults.enforceHTTPS,
            validateCertificate: custom.security?.validateCertificate ?? true,
            enableSSRFProtection: custom.security?.enableSSRFProtection ?? true,
            blockPrivateIPs: custom.security?.blockPrivateIPs ?? securityDefaults.blockPrivateIPs,
            blockLinkLocalIPs: custom.security?.blockLinkLocalIPs ?? securityDefaults.blockLinkLocalIPs,
            blockLoopbackIPs: custom.security?.blockLoopbackIPs ?? securityDefaults.blockLoopbackIPs,
            blockMetadataIPs: custom.security?.blockMetadataIPs ?? securityDefaults.blockMetadataIPs,
            blockDangerousPorts: custom.security?.blockDangerousPorts ?? securityDefaults.blockDangerousPorts,
            reResolveOnRedirect: custom.security?.reResolveOnRedirect ?? true,
            blockRedirectToPrivateIP: custom.security?.blockRedirectToPrivateIP ?? true,
            allowLocalhost: custom.security?.allowLocalhost ?? securityDefaults.allowLocalhost,
            sanitizeInputs: custom.security?.sanitizeInputs ?? true,
            sanitizeOutputs: custom.security?.sanitizeOutputs ?? true,
            ...(custom.security?.allowedHosts ? { allowedHosts: custom.security.allowedHosts } : {}),
            ...(custom.security?.deniedHosts ? { deniedHosts: custom.security.deniedHosts } : {}),
            ...(custom.security?.allowedProtocols ? { allowedProtocols: custom.security.allowedProtocols } : {}),
            ...(custom.security?.rateLimit ? { rateLimit: custom.security.rateLimit } : {}),
        },
        ...(custom.egressPolicy ? { egressPolicy: custom.egressPolicy } : {}),
        resilience: {
            enableCircuitBreaker: custom.resilience?.enableCircuitBreaker ?? true,
            failureThreshold: custom.resilience?.failureThreshold ?? 5,
            successThreshold: custom.resilience?.successThreshold ?? 2,
            circuitTimeout: custom.resilience?.circuitTimeout ?? 60_000,
            ...(custom.resilience?.circuitBreakerStorage ? { circuitBreakerStorage: custom.resilience.circuitBreakerStorage } : {}),
            enableRetry: custom.resilience?.enableRetry ?? true,
            maxRetries: custom.resilience?.maxRetries ?? 3,
            retryStrategy: custom.resilience?.retryStrategy ?? 'exponential',
            retryDelay: custom.resilience?.retryDelay ?? 1000,
            maxRetryDelay: custom.resilience?.maxRetryDelay ?? 30_000,
            retryJitter: custom.resilience?.retryJitter ?? true,
            retryMethods: custom.resilience?.retryMethods ?? ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'],
            ...(custom.resilience?.retryBudget ? { retryBudget: custom.resilience.retryBudget } : {}),
            retryableStatuses: custom.resilience?.retryableStatuses ?? [408, 429, 500, 502, 503, 504],
            retryableCodes: custom.resilience?.retryableCodes ?? ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENETUNREACH', 'ERR_HTTP2_STREAM_ERROR'],
            enableBulkhead: custom.resilience?.enableBulkhead ?? true,
            maxConcurrent: custom.resilience?.maxConcurrent ?? 10,
            maxQueue: custom.resilience?.maxQueue ?? 100,
            bulkheadQueueTimeout: custom.resilience?.bulkheadQueueTimeout ?? 30_000,
            ...(custom.resilience?.adaptiveConcurrency ? { adaptiveConcurrency: custom.resilience.adaptiveConcurrency } : {}),
            ...(custom.resilience?.shouldRetry ? { shouldRetry: custom.resilience.shouldRetry } : {}),
            ...(custom.resilience?.onRetry ? { onRetry: custom.resilience.onRetry } : {}),
        },
        performance: {
            enableCaching: custom.performance?.enableCaching ?? true,
            cacheMaxSize: custom.performance?.cacheMaxSize ?? 500,
            cacheTTL: custom.performance?.cacheTTL ?? 300_000,
            cacheMaxEntrySize: custom.performance?.cacheMaxEntrySize ?? 1_048_576,
            respectCacheHeaders: custom.performance?.respectCacheHeaders ?? true,
            deduplicateRequests: custom.performance?.deduplicateRequests ?? false,
            cacheStrategy: custom.performance?.cacheStrategy ?? 'ttl',
            cacheStaleMax: custom.performance?.cacheStaleMax ?? Math.max(custom.performance?.cacheTTL ?? 300_000, 1_500_000),
            ...(custom.performance?.cacheAdapter ? { cacheAdapter: custom.performance.cacheAdapter } : {}),
        },
    };
}

export function mergeConfig(base: NormalizedClientConfig, override: ClientConfig): ClientConfig {
    const overrideProfile = override.security?.profile === undefined
        ? undefined
        : normalizeSecurityProfile(override.security.profile);
    const security = overrideProfile && overrideProfile !== base.security.profile
        ? { ...override.security, profile: overrideProfile }
        : { ...base.security, ...(override.security ?? {}), ...(overrideProfile ? { profile: overrideProfile } : {}) };

    const headers = base.headers || override.headers
        ? NeutrxHeaders.concat(base.headers, override.headers)
        : undefined;

    return {
        ...base,
        ...override,
        ...(headers ? { headers } : {}),
        security,
        ...(override.egressPolicy ? { egressPolicy: override.egressPolicy } : {}),
        transitional: { ...base.transitional, ...(override.transitional ?? {}) },
        resilience: { ...base.resilience, ...(override.resilience ?? {}) },
        performance: { ...base.performance, ...(override.performance ?? {}) },
    };
}

export async function resolveServiceEndpoint(
    config: RequestConfig,
    defaults: NormalizedClientConfig,
    method: HttpMethod,
    state: ServiceDiscoveryState
): Promise<ServiceEndpoint | undefined> {
    const allowAbsoluteUrls = config.allowAbsoluteUrls ?? defaults.allowAbsoluteUrls;
    if (/^https?:\/\//i.test(config.url) && allowAbsoluteUrls !== false) return undefined;

    const serviceDiscovery = config.serviceDiscovery ?? defaults.serviceDiscovery;
    if (!serviceDiscovery) return undefined;

    const baseURL = config.baseURL ?? defaults.baseURL;
    const endpoints = await resolveEndpointList(serviceDiscovery, config, method, baseURL);
    if (endpoints.length === 0) {
        throw new NeutrxSecurityError('Service discovery returned no endpoints', { code: 'SERVICE_DISCOVERY_EMPTY' });
    }

    const pool = weightedEndpointPool(endpoints);
    if (pool.length === 0) {
        throw new NeutrxSecurityError('Service discovery returned no eligible endpoints', { code: 'SERVICE_DISCOVERY_EMPTY' });
    }

    const strategy = serviceDiscovery.strategy ?? 'round-robin';
    if (strategy === 'random') return pool[Math.floor(Math.random() * pool.length)];
    if (strategy === 'sticky-origin') return pool[hashString(`${baseURL ?? ''}|${config.url}`) % pool.length];

    const key = `${baseURL ?? ''}|${endpoints.map(endpoint => endpoint.url).join(',')}`;
    const current = state.counters.get(key) ?? 0;
    state.counters.set(key, current >= Number.MAX_SAFE_INTEGER ? 0 : current + 1);
    return pool[current % pool.length];
}

export function buildURL(config: RequestConfig, defaults: NormalizedClientConfig): string {
    let url = config.url;
    const isAbsoluteURL = /^https?:\/\//i.test(url);
    const allowAbsoluteUrls = config.allowAbsoluteUrls ?? defaults.allowAbsoluteUrls;
    if (!isAbsoluteURL || allowAbsoluteUrls === false) {
        const hasSocketPath = Boolean(config.socketPath ?? defaults.socketPath);
        const base = config.baseURL ?? defaults.baseURL ?? (hasSocketPath ? 'http://unix' : '');
        if (base) {
            url = `${base.endsWith('/') ? base.slice(0, -1) : base}${url.startsWith('/') ? url : `/${url}`}`;
        }
    }

    if (config.params && Object.keys(config.params).length > 0) {
        const parsed = new URL(url);
        const serializer = config.paramsSerializer ?? defaults.paramsSerializer;
        const serialized = serializeParams(config.params, serializer);
        if (serialized) parsed.search = serialized.startsWith('?') ? serialized.slice(1) : serialized;
        url = parsed.toString();
    }

    return url;
}

async function resolveEndpointList(
    serviceDiscovery: ServiceDiscoveryConfig,
    config: RequestConfig,
    method: HttpMethod,
    baseURL?: string
): Promise<readonly ServiceEndpoint[]> {
    const resolved = typeof serviceDiscovery.resolver === 'function'
        ? await serviceDiscovery.resolver({ request: config, ...(baseURL ? { baseURL } : {}), url: config.url, method })
        : serviceDiscovery.resolver;

    const configuredLimit = serviceDiscovery.maxEndpoints ?? DEFAULT_SERVICE_ENDPOINT_LIMIT;
    const limit = Number.isFinite(configuredLimit)
        ? Math.max(1, Math.floor(configuredLimit))
        : DEFAULT_SERVICE_ENDPOINT_LIMIT;
    return normalizeServiceEndpoints(resolved).slice(0, limit);
}

function normalizeServiceEndpoints(values: readonly (ServiceEndpoint | string)[]): readonly ServiceEndpoint[] {
    const endpoints: ServiceEndpoint[] = [];
    for (const value of values) {
        if (typeof value === 'string') {
            const url = value.trim();
            if (url) endpoints.push({ url });
            continue;
        }

        const url = value.url.trim();
        if (!url) continue;
        endpoints.push({ ...value, url });
    }
    return endpoints;
}

function weightedEndpointPool(endpoints: readonly ServiceEndpoint[]): readonly ServiceEndpoint[] {
    const pool: ServiceEndpoint[] = [];
    for (const endpoint of endpoints) {
        const weight = endpoint.weight === undefined
            ? 1
            : Number.isFinite(endpoint.weight)
            ? Math.min(MAX_SERVICE_ENDPOINT_WEIGHT, Math.floor(endpoint.weight))
            : 0;
        for (let index = 0; index < weight; index += 1) {
            pool.push(endpoint);
        }
    }
    return pool;
}

function hashString(value: string): number {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) % 2_147_483_647;
    }
    return hash;
}

export function normalizeMethod(method: string): HttpMethod {
    const normalized = method.toUpperCase();
    if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(normalized)) return normalized as HttpMethod;
    throw new NeutrxSecurityError(`Invalid HTTP method: ${method}`, { code: 'INVALID_METHOD' });
}

export function normalizeArray<TValue>(value: TValue | readonly TValue[]): readonly TValue[] {
    return (Array.isArray(value) ? value : [value]) as readonly TValue[];
}

export function mergeTransformRequest(
    base?: readonly TransformRequest[],
    override?: TransformRequest | readonly TransformRequest[]
): readonly TransformRequest[] | undefined {
    const merged = [...(base ?? []), ...(override ? normalizeArray(override) : [])];
    return merged.length > 0 ? merged : undefined;
}

export function mergeTransformResponse(
    base?: readonly TransformResponse[],
    override?: TransformResponse | readonly TransformResponse[]
): readonly TransformResponse[] | undefined {
    const merged = [...(base ?? []), ...(override ? normalizeArray(override) : [])];
    return merged.length > 0 ? merged : undefined;
}

export function applyRequestTransforms(
    data: RequestBody | undefined,
    headers: InternalHeaders,
    transforms?: readonly TransformRequest[]
): RequestBody | undefined {
    return (transforms ?? []).reduce<RequestBody | undefined>((current, transform) => transform(current, headers), data);
}

export function applyResponseTransforms(
    data: ParsedResponseData,
    headers: Headers,
    status: number,
    transforms?: readonly TransformResponse[]
): ParsedResponseData {
    return (transforms ?? []).reduce<ParsedResponseData>((current, transform) => transform(current, headers, status), data);
}

export function detectAdapter(config?: InternalRequestConfig | NormalizedClientConfig): RequestAdapterName {
    if (config && isHttp2Version(config.httpVersion)) return 'http2';
    if (typeof globalThis.fetch === 'function' && typeof process === 'undefined') return 'fetch';
    return 'http';
}

function serializeParams(params: QueryParams, serializer?: RequestConfig['paramsSerializer']): string {
    if (typeof serializer === 'function') return serializer(params);
    if (serializer?.serialize) return serializer.serialize(params);

    const encoded = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) appendSearchParam(encoded, key, value, serializer?.encode, serializer?.indexes);
    return encoded.toString();
}

function appendSearchParam(
    params: URLSearchParams,
    key: string,
    value: QueryValue,
    encode?: (value: string) => string,
    indexes?: boolean | null
): void {
    if (value == null) return;
    const encodedKey = encode ? encode(key) : key;
    if (Array.isArray(value)) {
        const items = value as readonly QueryValue[];
        items.forEach((item, index) => appendSearchParam(params, arrayParamKey(key, index, indexes), item, encode, indexes));
        return;
    }
    if (typeof value === 'object') {
        const record = value as QueryParams;
        for (const childKey of Object.keys(record)) {
            const child = record[childKey];
            appendSearchParam(params, `${key}[${childKey}]`, child, encode, indexes);
        }
        return;
    }
    params.append(encodedKey, encode ? encode(String(value)) : String(value));
}

function arrayParamKey(key: string, index: number, indexes?: boolean | null): string {
    if (indexes === true) return `${key}[${index}]`;
    if (indexes === false) return `${key}[]`;
    return key;
}

function isHttp2Version(value: unknown): boolean {
    return value === 2 || value === '2';
}

function securityProfileDefaults(profile: NormalizedClientConfig['security']['profile']): {
    readonly enforceHTTPS: boolean;
    readonly blockPrivateIPs: boolean;
    readonly blockLinkLocalIPs: boolean;
    readonly blockLoopbackIPs: boolean;
    readonly blockMetadataIPs: boolean;
    readonly blockDangerousPorts: boolean;
    readonly allowLocalhost: boolean;
} {
    if (profile === 'legacy') {
        return {
            enforceHTTPS: false,
            blockPrivateIPs: false,
            blockLinkLocalIPs: false,
            blockLoopbackIPs: false,
            blockMetadataIPs: false,
            blockDangerousPorts: false,
            allowLocalhost: true,
        };
    }

    return {
        enforceHTTPS: true,
        blockPrivateIPs: true,
        blockLinkLocalIPs: true,
        blockLoopbackIPs: true,
        blockMetadataIPs: true,
        blockDangerousPorts: true,
        allowLocalhost: false,
    };
}

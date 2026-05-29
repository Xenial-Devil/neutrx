import { NeutrxSecurityError } from './NeutrxError.js';
import { NeutrxHeaders } from './headers.js';
import type {
    ClientConfig,
    Headers,
    HeaderSource,
    HeaderValue,
    HttpMethod,
} from '../types.js';

type MutableClientDefaults = {
    -readonly [Key in keyof Omit<ClientConfig, 'headers'>]?: ClientConfig[Key];
};

export interface HeaderDefaults {
    common: Headers;
    get: Headers;
    post: Headers;
    put: Headers;
    patch: Headers;
    delete: Headers;
    head: Headers;
    options: Headers;
    [header: string]: HeaderValue | Headers;
}

export interface NeutrxDefaults extends MutableClientDefaults {
    [key: string]: unknown;
    get headers(): HeaderDefaults;
    set headers(value: HeaderSource | HeaderDefaults | undefined);
}

type HeaderGroup = keyof Pick<HeaderDefaults, 'common' | 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options'>;
type DefaultsToConfigOptions = { readonly rejectUnsafe?: boolean };

const HEADER_GROUPS = ['common', 'get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const satisfies readonly HeaderGroup[];
const UNSAFE_LIVE_DEFAULT_KEYS = ['security', 'egressPolicy', 'resilience', 'performance'] as const;
const SAFE_DEFAULT_KEYS = [
    'baseURL',
    'allowAbsoluteUrls',
    'timeout',
    'connectTimeout',
    'maxRedirects',
    'maxContentLength',
    'maxBodyLength',
    'responseEncoding',
    'auth',
    'idempotencyKey',
    'idempotencyKeyHeader',
    'validateStatus',
    'paramsSerializer',
    'formSerializer',
    'transformRequest',
    'transformResponse',
    'parseJson',
    'stringifyJson',
    'throwHttpErrors',
    'adapter',
    'fetch',
    'httpVersion',
    'http2Options',
    'serviceDiscovery',
    'withCredentials',
    'credentials',
    'xsrfCookieName',
    'xsrfHeaderName',
    'withXSRFToken',
    'instrumentation',
    'proxy',
    'tls',
    'beforeRedirect',
    'httpAgent',
    'httpsAgent',
    'lookup',
    'socketPath',
    'decompress',
    'maxRate',
    'transitional',
] as const satisfies readonly (keyof ClientConfig)[];

const INITIAL_DEFAULT_KEYS = SAFE_DEFAULT_KEYS.filter(
    key => key !== 'transformRequest' && key !== 'transformResponse'
);

export function createMutableDefaults(initial: ClientConfig = {}): NeutrxDefaults {
    const state: NeutrxDefaults = { headers: createHeaderDefaults(initial.headers) };

    for (const key of INITIAL_DEFAULT_KEYS) {
        const value = initial[key];
        if (value !== undefined) state[key as string] = value;
    }

    return new Proxy(state, {
        get(target, property, receiver): unknown {
            if (property === 'headers') return target.headers;
            return Reflect.get(target, property, receiver);
        },
        set(target, property, value, receiver): boolean {
            if (property === 'headers') {
                const input: unknown = value;
                setHeaderDefaults(target.headers, input as HeaderSource | HeaderDefaults | undefined);
                return true;
            }
            return Reflect.set(target, property, value, receiver);
        },
        deleteProperty(target, property): boolean {
            if (property === 'headers') {
                clearHeaderDefaults(target.headers);
                return true;
            }
            return Reflect.deleteProperty(target, property);
        },
    });
}

export function mergeDefaults(
    defaults: NeutrxDefaults | undefined,
    config: ClientConfig,
    method?: HttpMethod | Lowercase<HttpMethod>
): ClientConfig {
    if (!defaults) return config;
    const defaultsConfig = defaultsToConfig(defaults, method);
    const headers = defaultsConfig.headers || config.headers
        ? NeutrxHeaders.concat(defaultsConfig.headers, config.headers)
        : undefined;

    return {
        ...defaultsConfig,
        ...config,
        ...(headers ? { headers } : {}),
        ...(defaultsConfig.security || config.security ? { security: { ...defaultsConfig.security, ...config.security } } : {}),
        ...(defaultsConfig.resilience || config.resilience ? { resilience: { ...defaultsConfig.resilience, ...config.resilience } } : {}),
        ...(defaultsConfig.performance || config.performance ? { performance: { ...defaultsConfig.performance, ...config.performance } } : {}),
        ...(defaultsConfig.instrumentation || config.instrumentation ? { instrumentation: { ...defaultsConfig.instrumentation, ...config.instrumentation } } : {}),
        ...(defaultsConfig.transitional || config.transitional ? { transitional: { ...defaultsConfig.transitional, ...config.transitional } } : {}),
    };
}

export function defaultsToConfig(
    defaults: NeutrxDefaults,
    method?: HttpMethod | Lowercase<HttpMethod>,
    options: DefaultsToConfigOptions = {}
): ClientConfig {
    const config: Record<string, unknown> = {};

    for (const key of UNSAFE_LIVE_DEFAULT_KEYS) {
        if (defaults[key] === undefined) continue;
        if (options.rejectUnsafe) {
            throw new NeutrxSecurityError(
                `Cannot mutate live instance defaults.${key}; create a new client or use the dedicated setter instead`,
                { code: 'UNSAFE_DEFAULT_MUTATION' }
            );
        }
        config[key] = defaults[key];
    }

    for (const key of SAFE_DEFAULT_KEYS) {
        const value = defaults[key];
        if (value !== undefined) config[key] = value;
    }

    const headers = flattenHeaderDefaults(defaults.headers, method);
    if (Object.keys(headers.toJSON({ includeBlocked: true })).length > 0) {
        config.headers = headers;
    }

    return config;
}

function createHeaderDefaults(init?: HeaderSource | HeaderDefaults): HeaderDefaults {
    const groups = Object.fromEntries(
        HEADER_GROUPS.map(group => [group, new NeutrxHeaders()])
    ) as Record<HeaderGroup, NeutrxHeaders>;
    const target: HeaderDefaults = {
        common: groups.common as unknown as Headers,
        get: groups.get as unknown as Headers,
        post: groups.post as unknown as Headers,
        put: groups.put as unknown as Headers,
        patch: groups.patch as unknown as Headers,
        delete: groups.delete as unknown as Headers,
        head: groups.head as unknown as Headers,
        options: groups.options as unknown as Headers,
    };
    const proxy = new Proxy(target, {
        get(_target, property): unknown {
            if (isHeaderGroup(property)) return groups[property];
            if (typeof property === 'string') return groups.common.get(property);
            return undefined;
        },
        set(_target, property, value): boolean {
            if (isHeaderGroup(property)) {
                const source: unknown = value;
                groups[property] = NeutrxHeaders.from(source as HeaderSource);
                return true;
            }
            if (typeof property === 'string') {
                groups.common.set(property, value as HeaderValue | null | undefined);
                return true;
            }
            return false;
        },
        deleteProperty(_target, property): boolean {
            if (isHeaderGroup(property)) {
                groups[property].clear();
                return true;
            }
            return typeof property === 'string' ? groups.common.delete(property) : false;
        },
        has(_target, property): boolean {
            return isHeaderGroup(property) || (typeof property === 'string' && groups.common.has(property));
        },
        ownKeys(): ArrayLike<string | symbol> {
            return Array.from(groups.common.keys());
        },
        getOwnPropertyDescriptor(_target, property): PropertyDescriptor | undefined {
            if (isHeaderGroup(property)) {
                return {
                    configurable: true,
                    enumerable: false,
                    value: groups[property],
                    writable: true,
                };
            }
            if (typeof property === 'string' && groups.common.has(property)) {
                const value = groups.common.get(property);
                if (value !== undefined && value !== false) {
                    return {
                        configurable: true,
                        enumerable: true,
                        value,
                        writable: true,
                    };
                }
            }
            return undefined;
        },
    });

    setHeaderDefaults(proxy, init);
    return proxy;
}

function setHeaderDefaults(target: HeaderDefaults, init?: HeaderSource | HeaderDefaults): void {
    clearHeaderDefaults(target);
    if (!init) return;

    if (isHeaderDefaults(init)) {
        for (const group of HEADER_GROUPS) {
            const value = init[group];
            if (value !== undefined) (target[group] as unknown as NeutrxHeaders).setAll(value as HeaderSource);
        }
        for (const [name, value] of Object.entries(init)) {
            if (!isHeaderGroup(name) && value !== undefined) {
                (target.common as unknown as NeutrxHeaders).set(name, value as HeaderValue);
            }
        }
        return;
    }

    (target.common as unknown as NeutrxHeaders).setAll(init);
}

function clearHeaderDefaults(target: HeaderDefaults): void {
    for (const group of HEADER_GROUPS) {
        (target[group] as unknown as NeutrxHeaders).clear();
    }
}

function flattenHeaderDefaults(headers: HeaderDefaults | HeaderSource, method?: HttpMethod | Lowercase<HttpMethod>): NeutrxHeaders {
    if (!isHeaderDefaults(headers)) return NeutrxHeaders.from(headers);
    const normalizedMethod = method?.toLowerCase() as HeaderGroup | undefined;
    return NeutrxHeaders.concat(
        headers.common as HeaderSource,
        normalizedMethod && normalizedMethod !== 'common' && isHeaderGroup(normalizedMethod)
            ? headers[normalizedMethod] as HeaderSource
            : undefined,
        Object.fromEntries(Object.entries(headers).filter(([name]) => !isHeaderGroup(name))) as HeaderSource
    );
}

function isHeaderDefaults(value: unknown): value is HeaderDefaults {
    return value !== null
        && typeof value === 'object'
        && 'common' in value
        && HEADER_GROUPS.every(group => typeof (value as Record<string, unknown>)[group] === 'object');
}

function isHeaderGroup(value: unknown): value is HeaderGroup {
    return typeof value === 'string' && (HEADER_GROUPS as readonly string[]).includes(value);
}

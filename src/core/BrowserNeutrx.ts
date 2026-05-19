import type {
    ClientConfig,
    NeutrxResponse,
    ParsedResponseData,
    RequestBody,
    RequestConfig,
} from '../types.js';
import BrowserClient from './BrowserClient.js';
import { NeutrxHeaders } from './headers.js';

type CallableRequestConfig<TBody extends RequestBody = RequestBody> = Omit<RequestConfig<TBody>, 'url'>;

interface CallableRequest {
    <TData extends ParsedResponseData = ParsedResponseData, TBody extends RequestBody = RequestBody>(
        config: RequestConfig<TBody>
    ): Promise<NeutrxResponse<TData>>;
    <TData extends ParsedResponseData = ParsedResponseData, TBody extends RequestBody = RequestBody>(
        url: string,
        config?: CallableRequestConfig<TBody>
    ): Promise<NeutrxResponse<TData>>;
}

export type NeutrxInstance = Omit<BrowserClient, 'create'> & CallableRequest & {
    create(config?: ClientConfig): NeutrxInstance;
};

export type NeutrxDefaults = { -readonly [Key in keyof ClientConfig]?: ClientConfig[Key] };
export type NeutrxStatic = NeutrxInstance & { defaults: NeutrxDefaults };

function createCallableClient(
    getClient: () => BrowserClient,
    defaults?: NeutrxDefaults,
    createInstance?: (config: ClientConfig) => BrowserClient
): NeutrxInstance {
    const callable = (<TData extends ParsedResponseData = ParsedResponseData, TBody extends RequestBody = RequestBody>(
        input: string | RequestConfig<TBody>,
        config: CallableRequestConfig<TBody> = {}
    ): Promise<NeutrxResponse<TData>> => {
        const requestConfig = typeof input === 'string' ? mergeRequestDefaults(defaults, { ...config, url: input }) : mergeRequestDefaults(defaults, input);
        return getClient().request<TData, TBody>(requestConfig);
    }) as unknown as NeutrxInstance;

    Object.defineProperty(callable, 'create', {
        value: (config: ClientConfig = {}): NeutrxInstance => {
            const next = createInstance ? createInstance(config) : getClient().create(config);
            return createCallableClient(() => next);
        },
        enumerable: true,
    });

    const proxyRef: { current: NeutrxInstance | null } = { current: null };
    const proxy = new Proxy(callable, {
        get(target, property, receiver): unknown {
            if (Reflect.has(target, property)) {
                const targetValue: unknown = Reflect.get(target, property, receiver);
                return targetValue;
            }

            const client = getClient();
            const value = Reflect.get(client, property, client) as unknown;
            if (typeof value !== 'function') return value;

            return (...args: unknown[]): unknown => {
                const result = invokeWithDefaults(client, value as (...methodArgs: unknown[]) => unknown, property, args, defaults);
                return result === client ? proxyRef.current : result;
            };
        },
        set(target, property, value, receiver) {
            if (Reflect.has(target, property)) {
                return Reflect.set(target, property, value, receiver);
            }
            return Reflect.set(getClient(), property, value, getClient());
        },
        has(target, property) {
            return Reflect.has(target, property) || Reflect.has(getClient(), property);
        },
        ownKeys(target) {
            return [...new Set([...Reflect.ownKeys(target), ...Reflect.ownKeys(getClient())])];
        },
        getOwnPropertyDescriptor(target, property) {
            return Reflect.getOwnPropertyDescriptor(target, property)
                ?? Reflect.getOwnPropertyDescriptor(getClient(), property);
        },
    });

    proxyRef.current = proxy;

    return proxy;
}

const defaults: NeutrxDefaults = {};
const rootClient = new BrowserClient({});
const Neutrx: NeutrxStatic = createCallableClient(
    () => rootClient,
    defaults,
    config => new BrowserClient(mergeClientDefaults(defaults, config))
) as NeutrxStatic;

Object.defineProperty(Neutrx, 'defaults', {
    value: defaults,
    enumerable: true,
});

export default Neutrx;

function mergeRequestDefaults<TBody extends RequestBody>(
    defaultsConfig: NeutrxDefaults | undefined,
    config: RequestConfig<TBody>
): RequestConfig<TBody> {
    if (!defaultsConfig) return config;
    return mergeClientDefaults(defaultsConfig, config) as RequestConfig<TBody>;
}

function mergeClientDefaults(defaultsConfig: NeutrxDefaults, config: ClientConfig): ClientConfig {
    const headers = defaultsConfig.headers || config.headers
        ? NeutrxHeaders.concat(defaultsConfig.headers, config.headers).toJSON()
        : undefined;
    return {
        ...defaultsConfig,
        ...config,
        ...(headers ? { headers } : {}),
        ...(defaultsConfig.security || config.security ? { security: { ...defaultsConfig.security, ...config.security } } : {}),
        ...(defaultsConfig.resilience || config.resilience ? { resilience: { ...defaultsConfig.resilience, ...config.resilience } } : {}),
        ...(defaultsConfig.performance || config.performance ? { performance: { ...defaultsConfig.performance, ...config.performance } } : {}),
        ...(defaultsConfig.instrumentation || config.instrumentation ? { instrumentation: { ...defaultsConfig.instrumentation, ...config.instrumentation } } : {}),
    };
}

function invokeWithDefaults(
    client: BrowserClient,
    method: (...methodArgs: unknown[]) => unknown,
    property: string | symbol,
    args: unknown[],
    defaultsConfig: NeutrxDefaults | undefined
): unknown {
    if (!defaultsConfig) return method.apply(client, args);
    if (property === 'request' && isRequestConfig(args[0])) {
        return client.request(mergeRequestDefaults(defaultsConfig, args[0]));
    }
    if (property === 'getUri') {
        const input = typeof args[0] === 'string' ? { url: args[0] } : args[0];
        return isRequestConfig(input) ? client.getUri(mergeRequestDefaults(defaultsConfig, input)) : method.apply(client, args);
    }
    if (isBodylessMethod(property) && typeof args[0] === 'string') {
        return method.call(client, args[0], mergeClientDefaults(defaultsConfig, configArg(args[1])));
    }
    if (isBodyMethod(property) && typeof args[0] === 'string') {
        return method.call(client, args[0], args[1], mergeClientDefaults(defaultsConfig, configArg(args[2])));
    }
    return method.apply(client, args);
}

function isRequestConfig(value: unknown): value is RequestConfig {
    return value !== null && typeof value === 'object' && typeof (value as { readonly url?: unknown }).url === 'string';
}

function configArg(value: unknown): ClientConfig {
    return value !== null && typeof value === 'object' ? value : {};
}

function isBodylessMethod(property: string | symbol): boolean {
    return property === 'get'
        || property === 'delete'
        || property === 'head'
        || property === 'options'
        || property === 'download';
}

function isBodyMethod(property: string | symbol): boolean {
    return property === 'post'
        || property === 'put'
        || property === 'patch'
        || property === 'postForm'
        || property === 'putForm'
        || property === 'patchForm'
        || property === 'postUrlEncoded'
        || property === 'putUrlEncoded'
        || property === 'patchUrlEncoded'
        || property === 'upload';
}

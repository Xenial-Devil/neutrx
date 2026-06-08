import type {
    ClientConfig,
    HttpMethod,
    NeutrxResponse,
    ParsedResponseData,
    RequestBody,
    RequestConfig,
    ResponseSchemaOption,
    SchemaResponseData,
} from '../types.js';
import BrowserClient from './BrowserClient.js';
import { Cancel, CancelToken, isCancel } from './cancel.js';
import { createMutableDefaults, mergeDefaults, type NeutrxDefaults } from './defaults.js';
import { isNeutrxError } from './NeutrxError.js';

export type { NeutrxDefaults } from './defaults.js';

type CallableRequestConfig<
    TBody extends RequestBody = RequestBody,
    TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined
> = Omit<RequestConfig<TBody, TSchema>, 'url'>;

interface CallableRequest {
    <
        TData extends ParsedResponseData = ParsedResponseData,
        TBody extends RequestBody = RequestBody,
        TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined
    >(
        config: RequestConfig<TBody, TSchema>
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>>;
    <
        TData extends ParsedResponseData = ParsedResponseData,
        TBody extends RequestBody = RequestBody,
        TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined
    >(
        url: string,
        config?: CallableRequestConfig<TBody, TSchema>
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>>;
}

export type NeutrxInstance = Omit<BrowserClient, 'create'> & CallableRequest & {
    create(config?: ClientConfig): NeutrxInstance;
};

export type NeutrxStatic = NeutrxInstance & {
    readonly Cancel: typeof Cancel;
    readonly CancelToken: typeof CancelToken;
    readonly defaults: NeutrxDefaults;
    readonly isNeutrxError: typeof isNeutrxError;
    readonly isCancel: typeof isCancel;
};

function createCallableClient(
    getClient: () => BrowserClient,
    defaults?: NeutrxDefaults,
    createInstance?: (config: ClientConfig) => BrowserClient
): NeutrxInstance {
    const callable = (<
        TData extends ParsedResponseData = ParsedResponseData,
        TBody extends RequestBody = RequestBody,
        TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined
    >(
        input: string | RequestConfig<TBody, TSchema>,
        config: CallableRequestConfig<TBody, TSchema> = {}
    ): Promise<NeutrxResponse<SchemaResponseData<TData, TSchema>>> => {
        const requestConfig = typeof input === 'string' ? mergeRequestDefaults(defaults, { ...config, url: input }) : mergeRequestDefaults(defaults, input);
        return getClient().request<TData, TBody, TSchema>(requestConfig);
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

const defaults = createMutableDefaults();
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
Object.defineProperty(Neutrx, 'Cancel', {
    value: Cancel,
    enumerable: true,
});
Object.defineProperty(Neutrx, 'CancelToken', {
    value: CancelToken,
    enumerable: true,
});
Object.defineProperty(Neutrx, 'isCancel', {
    value: isCancel,
    enumerable: true,
});
Object.defineProperty(Neutrx, 'isNeutrxError', {
    value: isNeutrxError,
    enumerable: true,
});

export default Neutrx;

function mergeRequestDefaults<TBody extends RequestBody, TSchema extends ResponseSchemaOption | undefined = ResponseSchemaOption | undefined>(
    defaultsConfig: NeutrxDefaults | undefined,
    config: RequestConfig<TBody, TSchema>
): RequestConfig<TBody, TSchema> {
    if (!defaultsConfig) return config;
    return mergeClientDefaults(defaultsConfig, config, config.method) as RequestConfig<TBody, TSchema>;
}

function mergeClientDefaults(
    defaultsConfig: NeutrxDefaults,
    config: ClientConfig,
    method?: HttpMethod | Lowercase<HttpMethod>
): ClientConfig {
    return mergeDefaults(defaultsConfig, config, method);
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
    if (property === 'ws' && typeof args[0] === 'string') {
        return method.call(client, args[0], mergeClientDefaults(defaultsConfig, configArg(args[1]), 'GET'));
    }
    if (isBodylessMethod(property) && typeof args[0] === 'string') {
        return method.call(client, args[0], mergeClientDefaults(defaultsConfig, configArg(args[1]), methodForProperty(property)));
    }
    if (isBodyMethod(property) && typeof args[0] === 'string') {
        return method.call(client, args[0], args[1], mergeClientDefaults(defaultsConfig, configArg(args[2]), methodForProperty(property)));
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

function methodForProperty(property: string | symbol): HttpMethod | undefined {
    if (property === 'delete') return 'DELETE';
    if (property === 'head') return 'HEAD';
    if (property === 'options') return 'OPTIONS';
    if (property === 'put' || property === 'putForm' || property === 'putUrlEncoded') return 'PUT';
    if (property === 'patch' || property === 'patchForm' || property === 'patchUrlEncoded') return 'PATCH';
    if (property === 'post' || property === 'postForm' || property === 'postUrlEncoded' || property === 'upload') return 'POST';
    if (property === 'get' || property === 'download') return 'GET';
    return undefined;
}

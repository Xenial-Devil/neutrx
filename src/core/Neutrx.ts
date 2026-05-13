import type {
    ClientConfig,
    NeutrxResponse,
    ParsedResponseData,
    RequestBody,
    RequestConfig,
} from '../types.js';
import NeutrxClient from './NeutrxClient.js';

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

export type NeutrxInstance = Omit<NeutrxClient, 'create'> & CallableRequest & {
    create(config?: ClientConfig): NeutrxInstance;
};

export type NeutrxStatic = NeutrxInstance;

function createCallableClient(client: NeutrxClient): NeutrxInstance {
    const callable = (<TData extends ParsedResponseData = ParsedResponseData, TBody extends RequestBody = RequestBody>(
        input: string | RequestConfig<TBody>,
        config: CallableRequestConfig<TBody> = {}
    ): Promise<NeutrxResponse<TData>> => {
        const requestConfig = typeof input === 'string' ? { ...config, url: input } : input;
        return client.request<TData, TBody>(requestConfig);
    }) as unknown as NeutrxInstance;

    Object.defineProperty(callable, 'create', {
        value: (config: ClientConfig = {}): NeutrxInstance => createCallableClient(client.create(config)),
        enumerable: true,
    });

    const proxyRef: { current: NeutrxInstance | null } = { current: null };
    const proxy = new Proxy(callable, {
        get(target, property, receiver): unknown {
            if (Reflect.has(target, property)) {
                const targetValue: unknown = Reflect.get(target, property, receiver);
                return targetValue;
            }

            const value = Reflect.get(client, property, client) as unknown;
            if (typeof value !== 'function') return value;

            return (...args: unknown[]): unknown => {
                const result = (value as (...methodArgs: unknown[]) => unknown).apply(client, args);
                return result === client ? proxyRef.current : result;
            };
        },
        set(target, property, value, receiver) {
            if (Reflect.has(target, property)) {
                return Reflect.set(target, property, value, receiver);
            }
            return Reflect.set(client, property, value, client);
        },
        has(target, property) {
            return Reflect.has(target, property) || Reflect.has(client, property);
        },
        ownKeys(target) {
            return [...new Set([...Reflect.ownKeys(target), ...Reflect.ownKeys(client)])];
        },
        getOwnPropertyDescriptor(target, property) {
            return Reflect.getOwnPropertyDescriptor(target, property)
                ?? Reflect.getOwnPropertyDescriptor(client, property);
        },
    });

    proxyRef.current = proxy;

    return proxy;
}

const Neutrx: NeutrxStatic = createCallableClient(new NeutrxClient({}));

export default Neutrx;

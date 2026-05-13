import type NeutrxClient from '../core/NeutrxClient.js';
import type {
    GraphQLResult,
    Headers,
    InternalRequestConfig,
    JsonValue,
    MockController,
    MockResponse,
    NeutrxResponse,
    OAuth2Config,
    ParsedResponseData,
} from '../types.js';

export type HookName = 'beforeRequest' | 'afterRequest' | 'onError';
export type HookContext = InternalRequestConfig | NeutrxResponse | Error;
export type HookFunction<TContext extends HookContext> = (context: TContext) => TContext | Promise<TContext>;
type BeforeRequestHook = (context: InternalRequestConfig) => InternalRequestConfig | Promise<InternalRequestConfig>;
type AfterRequestHook = (context: NeutrxResponse) => NeutrxResponse | Promise<NeutrxResponse>;
type ErrorHook = (context: Error) => Error | Promise<Error>;

export interface PluginApi {
    addHook(name: 'beforeRequest', fn: BeforeRequestHook): void;
    addHook(name: 'afterRequest', fn: AfterRequestHook): void;
    addHook(name: 'onError', fn: ErrorHook): void;
    addInterceptor: NeutrxClient['useRequest'];
}

export interface NeutrxPlugin {
    readonly name: string;
    readonly version?: string;
    install?(client: NeutrxClient, api: PluginApi): void;
    uninstall?(client: NeutrxClient): void;
}

interface RegisteredPlugin {
    readonly name: string;
    readonly version: string;
    readonly registeredAt: string;
}

export class PluginManager {
    #plugins = new Map<string, NeutrxPlugin & { readonly registeredAt: string }>();
    #hooks: {
        beforeRequest: BeforeRequestHook[];
        afterRequest: AfterRequestHook[];
        onError: ErrorHook[];
    } = {
        beforeRequest: [],
        afterRequest: [],
        onError: [],
    };
    #client: NeutrxClient;

    constructor(client: NeutrxClient) {
        this.#client = client;
    }

    use(plugin: NeutrxPlugin): this {
        if (!plugin.name) throw new Error('Plugin must have a name');
        if (this.#plugins.has(plugin.name)) return this;

        plugin.install?.(this.#client, {
            addHook: this.addHook.bind(this),
            addInterceptor: this.#client.useRequest.bind(this.#client),
        });

        this.#plugins.set(plugin.name, { ...plugin, registeredAt: new Date().toISOString() });
        return this;
    }

    unuse(name: string): void {
        this.#plugins.get(name)?.uninstall?.(this.#client);
        this.#plugins.delete(name);
    }

    addHook(name: 'beforeRequest', fn: BeforeRequestHook): void;
    addHook(name: 'afterRequest', fn: AfterRequestHook): void;
    addHook(name: 'onError', fn: ErrorHook): void;
    addHook(name: HookName, fn: BeforeRequestHook | AfterRequestHook | ErrorHook): void;
    addHook(name: HookName, fn: BeforeRequestHook | AfterRequestHook | ErrorHook): void {
        if (name === 'beforeRequest') this.#hooks.beforeRequest.push(fn as BeforeRequestHook);
        if (name === 'afterRequest') this.#hooks.afterRequest.push(fn as AfterRequestHook);
        if (name === 'onError') this.#hooks.onError.push(fn as ErrorHook);
    }

    async runHook(name: 'beforeRequest', context: InternalRequestConfig): Promise<InternalRequestConfig>;
    async runHook(name: 'afterRequest', context: NeutrxResponse): Promise<NeutrxResponse>;
    async runHook(name: 'onError', context: Error): Promise<Error>;
    async runHook(name: HookName, context: HookContext): Promise<HookContext> {
        if (name === 'beforeRequest' && isRequestConfig(context)) {
            let current = context;
            for (const hook of this.#hooks.beforeRequest) current = await hook(current);
            return current;
        }

        if (name === 'afterRequest' && isResponse(context)) {
            let current = context;
            for (const hook of this.#hooks.afterRequest) current = await hook(current);
            return current;
        }

        if (name === 'onError' && context instanceof Error) {
            let current = context;
            for (const hook of this.#hooks.onError) current = await hook(current);
            return current;
        }

        return context;
    }

    list(): RegisteredPlugin[] {
        return [...this.#plugins.values()].map(({ name, version, registeredAt }) => ({
            name,
            version: version ?? '1.0.0',
            registeredAt,
        }));
    }
}

export const OAuth2Plugin: NeutrxPlugin = {
    name: 'oauth2',
    version: '1.0.0',

    install(client) {
        let token: string | null = null;
        let expiry = 0;
        let oauthConfig: OAuth2Config | null = null;

        client.configureOAuth2 = (config: OAuth2Config): void => {
            oauthConfig = config;
        };

        client.addPluginHook('beforeRequest', async (config): Promise<InternalRequestConfig> => {
            if (!oauthConfig?.tokenURL || config.skipOAuth) return config;

            if (!token || Date.now() >= expiry - 30_000) {
                const response = await client.post<{ readonly access_token?: string; readonly expires_in?: number }>(
                    oauthConfig.tokenURL,
                    {
                        grant_type: oauthConfig.grantType ?? 'client_credentials',
                        client_id: oauthConfig.clientId ?? '',
                        client_secret: oauthConfig.clientSecret ?? '',
                        scope: oauthConfig.scope ?? '',
                    },
                    {
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        skipOAuth: true,
                    }
                );

                const accessToken = response.data.access_token;
                if (!accessToken) throw new Error('OAuth2 token response missing access_token');
                token = accessToken;
                expiry = Date.now() + (response.data.expires_in ?? 3600) * 1000;
            }

            return {
                ...config,
                headers: { ...config.headers, Authorization: `Bearer ${token}` },
            };
        });
    },
};

export const GraphQLPlugin: NeutrxPlugin = {
    name: 'graphql',
    version: '1.0.0',

    install(client) {
        client.gql = async <TData extends JsonValue = JsonValue>(
            endpoint: string,
            query: string,
            variables: Record<string, JsonValue> = {},
            options: { readonly operationName?: string; readonly headers?: Headers } = {}
        ): Promise<GraphQLResult<TData>> => {
            const response = await client.post<{
                readonly data?: TData;
                readonly errors?: readonly JsonValue[];
                readonly extensions?: JsonValue;
            }>(
                endpoint,
                {
                    query: query.trim(),
                    variables,
                    operationName: options.operationName ?? null,
                },
                {
                    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
                }
            );

            if (response.data.errors && response.data.errors.length > 0) {
                const error = new Error('GraphQL Error') as Error & {
                    graphQLErrors: readonly JsonValue[];
                    data?: TData;
                };
                error.graphQLErrors = response.data.errors;
                if (response.data.data !== undefined) error.data = response.data.data;
                throw error;
            }

            const graphResponse: GraphQLResult<TData> = {
                ...response,
                data: response.data.data ?? null,
            };
            if (response.data.extensions !== undefined) {
                return { ...graphResponse, extensions: response.data.extensions };
            }
            return graphResponse;
        };
    },
};

export const MockPlugin: NeutrxPlugin = {
    name: 'mock',
    version: '1.0.0',

    install(client) {
        const mocks = new Map<string | RegExp, MockResponse>();
        let isEnabled = false;

        const controller: MockController = {
            enable() {
                isEnabled = true;
                return controller;
            },
            disable() {
                isEnabled = false;
                return controller;
            },
            clear() {
                mocks.clear();
                return controller;
            },
            register<TData extends ParsedResponseData>(urlPattern: string | RegExp, response: MockResponse<TData>) {
                mocks.set(urlPattern, response);
                return controller;
            },
        };

        client.mock = controller;

        client.addPluginHook('beforeRequest', async (config): Promise<InternalRequestConfig> => {
            if (!isEnabled) return config;

            for (const [pattern, mock] of mocks) {
                const matched = typeof pattern === 'string'
                    ? config.url.includes(pattern)
                    : pattern.test(config.url);

                if (!matched) continue;
                if (mock.delay) await sleep(mock.delay);

                return {
                    ...config,
                    mockResponse: {
                        status: mock.status ?? 200,
                        statusText: mock.statusText ?? 'OK',
                        headers: mock.headers ?? { 'content-type': 'application/json' },
                        data: mock.data ?? null,
                        config,
                        timing: { duration: 0 },
                        requestId: config.requestId,
                    } satisfies NeutrxResponse,
                };
            }

            return config;
        });
    },
};

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function isRequestConfig(context: HookContext): context is InternalRequestConfig {
    return !(context instanceof Error) && 'method' in context && 'url' in context;
}

function isResponse(context: HookContext): context is NeutrxResponse {
    return !(context instanceof Error) && 'status' in context && 'data' in context;
}

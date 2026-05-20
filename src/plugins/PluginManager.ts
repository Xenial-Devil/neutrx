import type NeutrxClient from '../core/NeutrxClient.js';
import { NeutrxValidationError } from '../core/NeutrxError.js';
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
    ValidationIssue,
    ValidationPluginConfig,
    ValidationSchema,
} from '../types.js';
import { VERSION } from '../version.js';

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
            version: version ?? VERSION,
            registeredAt,
        }));
    }
}

export const OAuth2Plugin: NeutrxPlugin = {
    name: 'oauth2',
    version: VERSION,

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
    version: VERSION,

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
    version: VERSION,

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

export const ValidationPlugin: NeutrxPlugin = {
    name: 'validation',
    version: VERSION,

    install(client) {
        let defaults: ValidationPluginConfig = {};

        client.configureValidation = (config: ValidationPluginConfig): void => {
            defaults = config;
        };

        client.addPluginHook('beforeRequest', async (config): Promise<InternalRequestConfig> => {
            const schema = config.validation?.request ?? defaults.request;
            if (!schema) return config;

            const data = await validateValue(schema, config.data, 'request', config);
            if (!data.changed) return config;
            return data.value === undefined
                ? withoutData(config)
                : withData(config, data.value);
        });

        client.addPluginHook('afterRequest', async (response): Promise<NeutrxResponse> => {
            const schema = response.config.validation?.response ?? defaults.response;
            if (!schema) return response;

            const data = await validateValue(schema, response.data, 'response', response.config);
            return data.changed ? { ...response, data: data.value as NeutrxResponse['data'] } : response;
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

type ValidationOutcome = { readonly changed: boolean; readonly value?: unknown };

async function validateValue(
    schema: ValidationSchema,
    value: unknown,
    phase: 'request' | 'response',
    config: InternalRequestConfig
): Promise<ValidationOutcome> {
    try {
        return normalizeValidationResult(await runSchema(schema, value), schema);
    } catch (error: unknown) {
        throw validationError(phase, config, error);
    }
}

async function runSchema(schema: ValidationSchema, value: unknown): Promise<unknown> {
    if (typeof schema === 'function') return schema(value);
    if ('safeParse' in schema && typeof schema.safeParse === 'function') return schema.safeParse(value);
    if ('parse' in schema && typeof schema.parse === 'function') return schema.parse(value);
    if ('validate' in schema && typeof schema.validate === 'function') return schema.validate(value);
    if ('Check' in schema && typeof schema.Check === 'function') {
        if (schema.Check(value)) return true;
        return typeBoxIssues(schema, value);
    }
    throw new Error('Unsupported validation schema');
}

function normalizeValidationResult(result: unknown, schema: ValidationSchema): ValidationOutcome {
    if (result === undefined || result === true) return { changed: false };
    if (result === false) throw new ValidationFailureSignal(issuesFromUnknown(errorsFromSchema(schema)));
    if (Array.isArray(result) && result.every(isValidationIssueLike)) throw new ValidationFailureSignal(issuesFromUnknown(result));
    if (isValidationIssueLike(result)) throw new ValidationFailureSignal(issuesFromUnknown([result]));

    if (result !== null && typeof result === 'object' && 'success' in result) {
        const parsed = result as { readonly success?: unknown; readonly data?: unknown; readonly error?: unknown; readonly issues?: unknown };
        if (parsed.success === true) return 'data' in parsed ? { changed: true, value: parsed.data } : { changed: false };
        throw new ValidationFailureSignal(issuesFromUnknown(parsed.issues ?? parsed.error));
    }

    return { changed: true, value: result };
}

function validationError(phase: 'request' | 'response', config: InternalRequestConfig, error: unknown): NeutrxValidationError {
    if (error instanceof NeutrxValidationError) return error;
    const issues = error instanceof ValidationFailureSignal ? error.issues : issuesFromUnknown(error);
    return new NeutrxValidationError(phase, issues, {
        url: config.url,
        method: config.method,
        requestId: config.requestId,
    });
}

function issuesFromUnknown(value: unknown): readonly ValidationIssue[] {
    if (Array.isArray(value)) return value.flatMap(item => issuesFromUnknown(item));
    if (value instanceof Error) {
        const error = value as Error & { readonly issues?: unknown; readonly errors?: unknown };
        if (error.issues !== undefined) return issuesFromUnknown(error.issues);
        if (error.errors !== undefined) return issuesFromUnknown(error.errors);
        return [{ message: value.message }];
    }
    if (isValidationIssueLike(value)) return [toIssue(value)];
    if (value !== null && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (Array.isArray(record.issues)) return issuesFromUnknown(record.issues);
        if (Array.isArray(record.errors)) return issuesFromUnknown(record.errors);
        const path = pathFromUnknown(record.path ?? record.instancePath);
        return [{
            message: stringifyIssue(record.message ?? record.error ?? 'Validation failed'),
            ...(path ? { path } : {}),
            ...(typeof record.code === 'string' ? { code: record.code } : {}),
        }];
    }
    return [{ message: stringifyIssue(value ?? 'Validation failed') }];
}

function typeBoxIssues(schema: ValidationSchema, value: unknown): readonly ValidationIssue[] {
    if (!('Errors' in schema) || typeof schema.Errors !== 'function') return [{ message: 'Validation failed' }];
    return issuesFromUnknown([...schema.Errors(value)]);
}

function errorsFromSchema(schema: ValidationSchema): unknown {
    return typeof schema === 'function' || 'errors' in schema ? schema.errors : undefined;
}

function isValidationIssueLike(value: unknown): value is { readonly message: unknown; readonly path?: unknown; readonly code?: unknown } {
    return value !== null
        && typeof value === 'object'
        && 'message' in value
        && typeof (value as { readonly message?: unknown }).message === 'string';
}

function toIssue(value: { readonly message: unknown; readonly path?: unknown; readonly code?: unknown }): ValidationIssue {
    const path = pathFromUnknown(value.path);
    return {
        ...(path ? { path } : {}),
        message: stringifyIssue(value.message),
        ...(typeof value.code === 'string' ? { code: value.code } : {}),
    };
}

function pathFromUnknown(path: unknown): readonly (string | number)[] | undefined {
    if (Array.isArray(path)) {
        const next = path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number');
        return next.length > 0 ? next : undefined;
    }
    if (typeof path === 'string' && path) {
        const normalized = path.startsWith('/') ? path.slice(1).replace(/\//g, '.') : path;
        return normalized ? normalized.split('.').filter(Boolean) : undefined;
    }
    return undefined;
}

function stringifyIssue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.message;
    try {
        return JSON.stringify(value) ?? 'Validation failed';
    } catch {
        return String(value);
    }
}

function withoutData(config: InternalRequestConfig): InternalRequestConfig {
    const copy = { ...config } as { data?: unknown };
    delete copy.data;
    return copy as InternalRequestConfig;
}

function withData(config: InternalRequestConfig, data: unknown): InternalRequestConfig {
    return { ...config, data } as InternalRequestConfig;
}

class ValidationFailureSignal extends Error {
    readonly issues: readonly ValidationIssue[];

    constructor(issues: readonly ValidationIssue[]) {
        super('Validation failed');
        this.name = 'ValidationFailureSignal';
        this.issues = issues;
    }
}

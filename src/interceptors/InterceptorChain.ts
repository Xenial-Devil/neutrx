import { NeutrxHeaders } from '../core/headers.js';
import type { HeaderSource, InternalRequestConfig, NeutrxResponse, RequestBody } from '../types.js';

type RequestConfigResult<TBody extends RequestBody = RequestBody> = Omit<InternalRequestConfig<TBody>, 'headers'> & { readonly headers: HeaderSource };
type RequestFulfilled = (config: InternalRequestConfig) => RequestConfigResult | Promise<RequestConfigResult>;
type RequestRejectedResult = RequestConfigResult | Error;
type RequestRejected = (error: Error) => RequestRejectedResult | Promise<RequestRejectedResult>;
type ResponseFulfilled = (response: NeutrxResponse) => NeutrxResponse | Promise<NeutrxResponse>;
type ResponseRejected = (error: Error) => NeutrxResponse | Error | Promise<NeutrxResponse | Error>;

export interface RequestInterceptorOptions {
    readonly synchronous?: boolean;
    readonly runWhen?: (config: InternalRequestConfig) => boolean;
}

export interface NeutrxInterceptorManager<TValue> {
    use(
        onFulfilled?: (value: TValue) => TValue | Promise<TValue>,
        onRejected?: (error: Error) => TValue | Error | Promise<TValue | Error>
    ): number;
    eject(id: number): void;
    clear(): void;
}

export interface NeutrxRequestInterceptorManager {
    use(
        onFulfilled?: RequestFulfilled,
        onRejected?: (error: Error) => RequestConfigResult | Error | Promise<RequestConfigResult | Error>,
        options?: RequestInterceptorOptions
    ): number;
    eject(id: number): void;
    clear(): void;
}

export interface NeutrxInterceptors {
    readonly request: NeutrxRequestInterceptorManager;
    readonly response: NeutrxInterceptorManager<NeutrxResponse>;
}

interface RequestInterceptor {
    readonly onFulfilled?: RequestFulfilled;
    readonly onRejected?: RequestRejected;
    readonly options?: RequestInterceptorOptions;
}

interface ResponseInterceptor {
    readonly onFulfilled?: ResponseFulfilled;
    readonly onRejected?: ResponseRejected;
}

export default class InterceptorChain {
    #request = new Map<number, RequestInterceptor>();
    #response = new Map<number, ResponseInterceptor>();
    #counter = 0;

    addRequest(onFulfilled?: RequestFulfilled, onRejected?: RequestRejected, options?: RequestInterceptorOptions): number {
        const id = this.#counter;
        this.#counter += 1;
        this.#request.set(id, {
            ...(onFulfilled ? { onFulfilled } : {}),
            ...(onRejected ? { onRejected } : {}),
            ...(options ? { options } : {}),
        });
        return id;
    }

    addResponse(onFulfilled?: ResponseFulfilled, onRejected?: ResponseRejected): number {
        const id = this.#counter;
        this.#counter += 1;
        this.#response.set(id, {
            ...(onFulfilled ? { onFulfilled } : {}),
            ...(onRejected ? { onRejected } : {}),
        });
        return id;
    }

    remove(id: number): void {
        this.#request.delete(id);
        this.#response.delete(id);
    }

    clearRequest(): void {
        this.#request.clear();
    }

    clearResponse(): void {
        this.#response.clear();
    }

    managers(): NeutrxInterceptors {
        return {
            request: {
                use: (onFulfilled, onRejected, options) => this.addRequest(onFulfilled, onRejected, options),
                eject: id => this.#request.delete(id),
                clear: () => this.clearRequest(),
            },
            response: {
                use: (onFulfilled, onRejected) => this.addResponse(
                    onFulfilled,
                    onRejected
                ),
                eject: id => this.#response.delete(id),
                clear: () => this.clearResponse(),
            },
        };
    }

    async runRequest<TBody extends RequestBody>(config: InternalRequestConfig<TBody>): Promise<InternalRequestConfig<TBody>> {
        let current: InternalRequestConfig = config;
        let asyncChain: Promise<InternalRequestConfig> | null = null;

        for (const { onFulfilled, onRejected, options } of this.#request.values()) {
            if (options?.synchronous && asyncChain === null) {
                if (options.runWhen && !options.runWhen(current)) continue;
                try {
                    const result = onFulfilled ? onFulfilled(current) : current;
                    if (isPromiseLike(result)) {
                        asyncChain = result.then(normalizeRequestConfig);
                    } else {
                        current = normalizeRequestConfig(result);
                    }
                } catch (error: unknown) {
                    if (!onRejected) throw normalizeError(error);
                    const result = onRejected(normalizeError(error));
                    if (isPromiseLike(result)) {
                        asyncChain = result.then(normalizeRequestRejectedResult);
                    } else {
                        current = normalizeRequestRejectedResult(result);
                    }
                }
                continue;
            }

            asyncChain ??= Promise.resolve(current);
            asyncChain = asyncChain.then(async configValue => {
                if (options?.runWhen && !options.runWhen(configValue)) return configValue;
                try {
                    return normalizeRequestConfig(onFulfilled ? await onFulfilled(configValue) : configValue);
                } catch (error: unknown) {
                    if (!onRejected) throw normalizeError(error);
                    return normalizeRequestRejectedResult(await onRejected(normalizeError(error)));
                }
            });
        }

        if (asyncChain) {
            current = await asyncChain;
        }

        return current as InternalRequestConfig<TBody>;
    }

    async runResponse<TData extends NeutrxResponse>(response: TData): Promise<TData> {
        let current: NeutrxResponse = response;
        for (const { onFulfilled, onRejected } of this.#response.values()) {
            try {
                current = onFulfilled ? await onFulfilled(current) : current;
            } catch (error: unknown) {
                if (!onRejected) throw normalizeError(error);
                const handled = await onRejected(normalizeError(error));
                if (handled instanceof Error) throw handled;
                current = handled;
            }
        }
        return current as TData;
    }

    async runError(error: Error): Promise<NeutrxResponse | Error> {
        let current = error;
        for (const { onRejected } of this.#response.values()) {
            if (!onRejected) continue;
            try {
                return await onRejected(current);
            } catch (next: unknown) {
                current = normalizeError(next);
            }
        }
        return current;
    }
}

function normalizeRequestConfig<TBody extends RequestBody>(config: RequestConfigResult<TBody>): InternalRequestConfig<TBody> {
    return {
        ...config,
        headers: NeutrxHeaders.from(config.headers) as InternalRequestConfig<TBody>['headers'],
    };
}

function normalizeRequestRejectedResult<TBody extends RequestBody>(result: RequestRejectedResult): InternalRequestConfig<TBody> {
    if (result instanceof Error) throw result;
    return normalizeRequestConfig(result) as InternalRequestConfig<TBody>;
}

function normalizeError(error: unknown): Error {
    if (error instanceof Error) return error;
    return new Error(String(error));
}

function isPromiseLike<TValue>(value: TValue | Promise<TValue>): value is Promise<TValue> {
    return value !== null
        && typeof value === 'object'
        && typeof (value as { readonly then?: unknown }).then === 'function';
}

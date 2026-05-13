import type { InternalRequestConfig, NeutrxResponse, RequestBody } from '../types.js';

type RequestFulfilled = (config: InternalRequestConfig) => InternalRequestConfig | Promise<InternalRequestConfig>;
type RequestRejected = (error: Error) => InternalRequestConfig | Promise<InternalRequestConfig>;
type ResponseFulfilled = (response: NeutrxResponse) => NeutrxResponse | Promise<NeutrxResponse>;
type ResponseRejected = (error: Error) => NeutrxResponse | Error | Promise<NeutrxResponse | Error>;

interface RequestInterceptor {
    readonly onFulfilled?: RequestFulfilled;
    readonly onRejected?: RequestRejected;
}

interface ResponseInterceptor {
    readonly onFulfilled?: ResponseFulfilled;
    readonly onRejected?: ResponseRejected;
}

export default class InterceptorChain {
    #request = new Map<number, RequestInterceptor>();
    #response = new Map<number, ResponseInterceptor>();
    #counter = 0;

    addRequest(onFulfilled?: RequestFulfilled, onRejected?: RequestRejected): number {
        const id = this.#counter;
        this.#counter += 1;
        this.#request.set(id, {
            ...(onFulfilled ? { onFulfilled } : {}),
            ...(onRejected ? { onRejected } : {}),
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

    async runRequest<TBody extends RequestBody>(config: InternalRequestConfig<TBody>): Promise<InternalRequestConfig<TBody>> {
        let current: InternalRequestConfig = config;
        for (const { onFulfilled, onRejected } of this.#request.values()) {
            try {
                current = onFulfilled ? await onFulfilled(current) : current;
            } catch (error: unknown) {
                if (!onRejected) throw normalizeError(error);
                current = await onRejected(normalizeError(error));
            }
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

function normalizeError(error: unknown): Error {
    if (error instanceof Error) return error;
    return new Error(String(error));
}

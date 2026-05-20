import type { Canceler, CancelToken as CancelTokenContract, CancelTokenSource } from '../types.js';

type AbortSignalWithReason = AbortSignal & { readonly reason?: unknown };

export class Cancel extends Error {
    readonly __CANCEL__ = true;

    constructor(message = 'Request canceled') {
        super(message);
        this.name = 'Cancel';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class CancelToken implements CancelTokenContract {
    readonly promise: Promise<Cancel>;
    #reason?: Cancel;

    constructor(executor: (cancel: Canceler) => void) {
        let resolvePromise!: (reason: Cancel) => void;
        this.promise = new Promise<Cancel>(resolve => {
            resolvePromise = resolve;
        });

        const cancel: Canceler = message => {
            if (this.#reason) return;
            this.#reason = new Cancel(message);
            resolvePromise(this.#reason);
        };

        try {
            executor(cancel);
        } catch (error: unknown) {
            cancel(error instanceof Error ? error.message : String(error));
            throw error;
        }
    }

    get reason(): Cancel | undefined {
        return this.#reason;
    }

    throwIfRequested(): void {
        if (this.#reason) throw this.#reason;
    }

    toAbortSignal(): AbortSignal {
        const controller = new AbortController();
        if (this.#reason) {
            controller.abort(this.#reason);
            return controller.signal;
        }
        void this.promise.then(reason => {
            if (!controller.signal.aborted) controller.abort(reason);
        });
        return controller.signal;
    }

    static source(): CancelTokenSource {
        let cancel: Canceler = () => undefined;
        const token = new CancelToken(cancelHandler => {
            cancel = cancelHandler;
        });
        return { token, cancel };
    }
}

export function isCancel(error: unknown): error is Cancel {
    return Boolean(error && typeof error === 'object' && (error as { readonly __CANCEL__?: unknown }).__CANCEL__ === true);
}

export function mergeCancellationSignal(signal?: AbortSignal, cancelToken?: CancelTokenContract): AbortSignal | undefined {
    cancelToken?.throwIfRequested();
    if (!signal) return cancelToken?.toAbortSignal();
    if (!cancelToken) return signal;
    if (signal.aborted) return signal;

    const controller = new AbortController();
    const abort = (reason: unknown): void => {
        if (!controller.signal.aborted) controller.abort(reason);
    };
    const cleanup = (): void => {
        signal.removeEventListener('abort', onSignalAbort);
    };
    const onSignalAbort = (): void => {
        cleanup();
        abort(abortReason(signal));
    };

    signal.addEventListener('abort', onSignalAbort, { once: true });
    void cancelToken.promise.then(reason => {
        cleanup();
        abort(reason);
    });

    return controller.signal;
}

export function abortError(signal?: AbortSignal): Error {
    const reason = signal ? abortReason(signal) : undefined;
    if (reason instanceof Error) return reason;
    return Object.assign(new Error('Request aborted'), { name: 'AbortError' });
}

export function abortReason(signal: AbortSignal): unknown {
    return (signal as AbortSignalWithReason).reason;
}

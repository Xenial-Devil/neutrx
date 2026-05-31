import type {
    NeutrxWebSocketCloseEvent,
    NeutrxWebSocketData,
    NeutrxWebSocketErrorEvent,
    NeutrxWebSocketMessage,
    NeutrxWebSocketMessageEvent,
    NeutrxWebSocketOpenEvent,
    NeutrxWebSocketOptions,
    NeutrxWebSocketReconnectOptions,
    NeutrxWSConnection,
    RequestConfig,
} from '../types.js';
import { NeutrxSecurityError } from './NeutrxError.js';

export const WEB_SOCKET_CONNECTING = 0;
export const WEB_SOCKET_OPEN = 1;
export const WEB_SOCKET_CLOSING = 2;
export const WEB_SOCKET_CLOSED = 3;

export type NormalizedReconnect = {
    readonly enabled: boolean;
    readonly attempts: number;
    readonly delay: number;
    readonly maxDelay: number;
    readonly backoff: NonNullable<NeutrxWebSocketReconnectOptions['backoff']>;
    readonly factor: number;
};

export function webSocketRequestConfig<TMessage, TSend extends NeutrxWebSocketMessage>(
    url: string,
    options: NeutrxWebSocketOptions<TMessage, TSend>,
    defaultsBaseURL?: string
): RequestConfig {
    const baseURL = options.baseURL !== undefined
        ? httpUrlForWebSocket(options.baseURL)
        : defaultsBaseURL !== undefined ? httpUrlForWebSocket(defaultsBaseURL) : undefined;

    return {
        url: httpUrlForWebSocket(url),
        method: 'GET',
        ...(baseURL !== undefined ? { baseURL } : {}),
        ...(options.headers !== undefined ? { headers: options.headers } : {}),
        ...(options.auth !== undefined ? { auth: options.auth } : {}),
        ...(options.params !== undefined ? { params: options.params } : {}),
        ...(options.paramsSerializer !== undefined ? { paramsSerializer: options.paramsSerializer } : {}),
        ...(options.allowAbsoluteUrls !== undefined ? { allowAbsoluteUrls: options.allowAbsoluteUrls } : {}),
        ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
        ...(options.connectTimeout !== undefined ? { connectTimeout: options.connectTimeout } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
        ...(options.serviceDiscovery !== undefined ? { serviceDiscovery: options.serviceDiscovery } : {}),
        cache: false,
    };
}

export function webSocketUrl(url: string): string {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new NeutrxSecurityError('WebSocket URL must be absolute or use a client baseURL', { code: 'WEBSOCKET_URL' });
    }
    if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
    else if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
    else if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
        throw new NeutrxSecurityError(`Unsupported WebSocket protocol: ${parsed.protocol}`, { code: 'WEBSOCKET_PROTOCOL' });
    }
    return parsed.href;
}

export function httpUrlForWebSocket(url: string): string {
    if (/^wss:/iu.test(url)) return `https:${url.slice(4)}`;
    if (/^ws:/iu.test(url)) return `http:${url.slice(3)}`;
    return url;
}

export function createNativeWebSocketConnection<TMessage, TSend extends NeutrxWebSocketMessage>(
    url: string,
    options: NeutrxWebSocketOptions<TMessage, TSend>
): NeutrxWSConnection<TMessage, TSend> {
    const WebSocketCtor = options.webSocket ?? globalThis.WebSocket;
    if (typeof WebSocketCtor !== 'function') {
        throw new NeutrxSecurityError('WebSocket is unavailable in this runtime', { code: 'WEBSOCKET_UNAVAILABLE' });
    }

    const reconnect = normalizeWebSocketReconnect(options.reconnect);
    let socket: WebSocket | undefined;
    let closedByCaller = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = (): void => {
        socket = new WebSocketCtor(url, options.protocols as string | string[] | undefined);
        socket.onopen = nativeEvent => {
            attempts = 0;
            options.onOpen?.(openEvent(url, nativeEvent));
        };
        socket.onmessage = nativeEvent => {
            const raw = normalizeNativeMessage(nativeEvent.data);
            dispatchMessage(options, raw, nativeEvent);
        };
        socket.onerror = nativeEvent => {
            options.onError?.(errorEvent(undefined, nativeEvent));
        };
        socket.onclose = nativeEvent => {
            options.onClose?.(closeEvent(nativeEvent.code, nativeEvent.reason, nativeEvent.wasClean, nativeEvent));
            if (closedByCaller || !canReconnect(reconnect, attempts)) return;
            const delay = reconnectDelay(reconnect, attempts + 1);
            attempts += 1;
            timer = setTimeout(connect, delay);
        };
    };

    connect();

    return {
        url,
        get readyState() {
            return socket?.readyState;
        },
        send(data: TSend) {
            if (socket?.readyState !== (WebSocketCtor.OPEN ?? WEB_SOCKET_OPEN)) {
                throw new NeutrxSecurityError('WebSocket is not open', { code: 'WEBSOCKET_NOT_OPEN' });
            }
            socket.send(serializeWebSocketMessage(options, data) as never);
        },
        close(code?: number, reason?: string) {
            closedByCaller = true;
            if (timer) clearTimeout(timer);
            socket?.close(code, reason);
        },
    };
}

export function normalizeWebSocketReconnect(value: NeutrxWebSocketOptions['reconnect']): NormalizedReconnect {
    if (value === false || value === undefined) {
        return { enabled: false, attempts: 0, delay: 0, maxDelay: 0, backoff: 'fixed', factor: 1 };
    }

    const options = value === true ? {} : value;
    const delay = positiveInteger(options.delay ?? options.minDelay, 1000);
    return {
        enabled: true,
        attempts: positiveInteger(options.attempts, 3),
        delay,
        maxDelay: positiveInteger(options.maxDelay, 30_000),
        backoff: options.backoff ?? (options.factor !== undefined ? 'exponential' : 'exponential'),
        factor: positiveNumber(options.factor, 2),
    };
}

export function canReconnect(reconnect: NormalizedReconnect, attempts: number): boolean {
    return reconnect.enabled && attempts < reconnect.attempts;
}

export function reconnectDelay(reconnect: NormalizedReconnect, attempt: number): number {
    const raw = typeof reconnect.backoff === 'function'
        ? reconnect.backoff(attempt)
        : reconnect.backoff === 'fixed'
            ? reconnect.delay
            : reconnect.backoff === 'linear'
                ? reconnect.delay * attempt
                : reconnect.delay * reconnect.factor ** Math.max(0, attempt - 1);
    const normalized = Number.isFinite(raw) && raw >= 0 ? raw : reconnect.delay;
    return Math.min(reconnect.maxDelay, Math.floor(normalized));
}

export function dispatchMessage<TMessage, TSend extends NeutrxWebSocketMessage>(
    options: NeutrxWebSocketOptions<TMessage, TSend>,
    raw: NeutrxWebSocketData,
    nativeEvent?: unknown
): void {
    try {
        const data = options.parseMessage ? options.parseMessage(raw) : raw as TMessage;
        options.onMessage?.(data, messageEvent(data, raw, nativeEvent));
    } catch (error: unknown) {
        options.onError?.(errorEvent(normalizeError(error), nativeEvent));
    }
}

export function serializeWebSocketMessage<TMessage, TSend extends NeutrxWebSocketMessage>(
    options: NeutrxWebSocketOptions<TMessage, TSend>,
    data: TSend
): NeutrxWebSocketMessage {
    return options.serializeMessage ? options.serializeMessage(data) : data;
}

export function openEvent(url: string, nativeEvent?: unknown): NeutrxWebSocketOpenEvent {
    return {
        type: 'open',
        url,
        ...(nativeEvent !== undefined ? { nativeEvent } : {}),
    };
}

export function messageEvent<TMessage>(
    data: TMessage,
    raw: NeutrxWebSocketData,
    nativeEvent?: unknown
): NeutrxWebSocketMessageEvent<TMessage> {
    return {
        type: 'message',
        data,
        raw,
        ...(nativeEvent !== undefined ? { nativeEvent } : {}),
    };
}

export function errorEvent(error?: Error, nativeEvent?: unknown): NeutrxWebSocketErrorEvent {
    return {
        type: 'error',
        ...(error !== undefined ? { error } : {}),
        ...(nativeEvent !== undefined ? { nativeEvent } : {}),
    };
}

export function closeEvent(code: number, reason: string, wasClean: boolean, nativeEvent?: unknown): NeutrxWebSocketCloseEvent {
    return {
        type: 'close',
        code,
        reason,
        wasClean,
        ...(nativeEvent !== undefined ? { nativeEvent } : {}),
    };
}

function normalizeNativeMessage(data: unknown): NeutrxWebSocketData {
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) return data;
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    }
    if (typeof Blob !== 'undefined' && data instanceof Blob) return data;
    return String(data);
}

function positiveInteger(value: number | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function positiveNumber(value: number | undefined, fallback: number): number {
    return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeError(error: unknown): Error {
    if (error instanceof Error) return error;
    return new Error(String(error));
}

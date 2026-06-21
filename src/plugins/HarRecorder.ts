import { NeutrxHeaders, headerToString } from '../core/headers.js';
import { isNeutrxError } from '../core/NeutrxError.js';
import type {
    HeaderValue,
    Headers,
    InternalRequestConfig,
    ParsedResponseData,
    RequestBody,
} from '../types.js';
import { VERSION } from '../version.js';
import type { NeutrxPlugin } from './PluginManager.js';

const DEFAULT_REDACTED = ['authorization', 'cookie', 'set-cookie', 'x-amz-security-token'];
const REDACTION = '[REDACTED]';

export interface HarRecorderOptions {
    /** Keep at most this many entries (oldest dropped first). Unbounded by default. */
    readonly maxEntries?: number;
    /** Capture request bodies in `postData`. Default `true`. */
    readonly includeRequestBody?: boolean;
    /** Capture response bodies in `content.text`. Default `true`. */
    readonly includeResponseBody?: boolean;
    /**
     * Header names whose values are masked in the HAR output. Default redacts
     * `authorization`, `cookie`, `set-cookie`, `x-amz-security-token`. Pass `false` to keep raw values.
     */
    readonly redactHeaders?: readonly string[] | false;
}

export interface HarNameValue {
    readonly name: string;
    readonly value: string;
}

export interface HarPostData {
    readonly mimeType: string;
    readonly text: string;
}

export interface HarRequest {
    readonly method: string;
    readonly url: string;
    readonly httpVersion: string;
    readonly headers: readonly HarNameValue[];
    readonly queryString: readonly HarNameValue[];
    readonly headersSize: number;
    readonly bodySize: number;
    readonly postData?: HarPostData;
}

export interface HarContent {
    readonly size: number;
    readonly mimeType: string;
    readonly text?: string;
    readonly encoding?: string;
}

export interface HarResponse {
    readonly status: number;
    readonly statusText: string;
    readonly httpVersion: string;
    readonly headers: readonly HarNameValue[];
    readonly content: HarContent;
    readonly redirectURL: string;
    readonly headersSize: number;
    readonly bodySize: number;
}

export interface HarEntry {
    readonly startedDateTime: string;
    readonly time: number;
    readonly request: HarRequest;
    readonly response: HarResponse;
    readonly cache: Record<string, never>;
    readonly timings: { readonly send: number; readonly wait: number; readonly receive: number };
    readonly _requestId?: string;
    readonly _error?: string;
}

export interface HarLog {
    readonly log: {
        readonly version: '1.2';
        readonly creator: { readonly name: string; readonly version: string };
        readonly entries: readonly HarEntry[];
    };
}

export interface HarRecorder {
    /** Plugin to register via `client.use(recorder.plugin)`. */
    readonly plugin: NeutrxPlugin;
    /** Recorded entries in insertion order. */
    entries(): readonly HarEntry[];
    /** Full HAR 1.2 log object. */
    har(): HarLog;
    /** Serialized HAR 1.2 JSON. */
    export(): string;
    /** Drop all recorded entries. */
    clear(): void;
}

/** Records every request/response (and failed request) into an in-memory HAR 1.2 log. */
export function createHarRecorder(options: HarRecorderOptions = {}): HarRecorder {
    const includeRequestBody = options.includeRequestBody ?? true;
    const includeResponseBody = options.includeResponseBody ?? true;
    const redactList = options.redactHeaders === false
        ? null
        : (options.redactHeaders ?? DEFAULT_REDACTED).map(name => name.toLowerCase());
    const entries: HarEntry[] = [];

    const push = (entry: HarEntry): void => {
        entries.push(entry);
        if (options.maxEntries !== undefined && entries.length > options.maxEntries) {
            entries.splice(0, entries.length - options.maxEntries);
        }
    };

    const plugin: NeutrxPlugin = {
        name: 'har-recorder',
        version: VERSION,

        install(client) {
            client.addPluginHook('afterRequest', response => {
                push(buildEntry(response.config, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers,
                    data: response.data,
                    time: response.timing.duration,
                    requestId: response.requestId,
                }, includeRequestBody, includeResponseBody, redactList));
                return response;
            });

            client.addPluginHook('onError', error => {
                const config = errorConfig(error);
                if (config) {
                    push(buildEntry(config, {
                        status: 0,
                        statusText: '',
                        headers: {},
                        data: null,
                        time: errorDuration(error),
                        requestId: config.requestId,
                        error: error.message,
                    }, includeRequestBody, includeResponseBody, redactList));
                }
                return error;
            });
        },
    };

    return {
        plugin,
        entries: () => entries.slice(),
        har: () => ({
            log: {
                version: '1.2',
                creator: { name: 'neutrx', version: VERSION },
                entries: entries.slice(),
            },
        }),
        export: () => JSON.stringify({
            log: {
                version: '1.2',
                creator: { name: 'neutrx', version: VERSION },
                entries,
            },
        }),
        clear: () => {
            entries.length = 0;
        },
    };
}

interface ResponseSnapshot {
    readonly status: number;
    readonly statusText: string;
    readonly headers: Headers;
    readonly data: ParsedResponseData;
    readonly time: number;
    readonly requestId?: string;
    readonly error?: string;
}

function buildEntry(
    config: InternalRequestConfig,
    response: ResponseSnapshot,
    includeRequestBody: boolean,
    includeResponseBody: boolean,
    redactList: readonly string[] | null
): HarEntry {
    const content = responseContent(response.data, response.headers, includeResponseBody);
    const request: HarRequest = {
        method: config.method,
        url: config.url,
        httpVersion: 'HTTP/1.1',
        headers: headerList(config.headers, redactList),
        queryString: queryString(config.url),
        headersSize: -1,
        bodySize: includeRequestBody && config.data !== undefined ? -1 : 0,
        ...(includeRequestBody ? postData(config) : {}),
    };
    const harResponse: HarResponse = {
        status: response.status,
        statusText: response.statusText,
        httpVersion: 'HTTP/1.1',
        headers: headerList(response.headers, redactList),
        content,
        redirectURL: headerToString(findHeader(response.headers, 'location')),
        headersSize: -1,
        bodySize: content.text !== undefined ? content.size : -1,
    };

    return {
        startedDateTime: new Date(config.startTime).toISOString(),
        time: response.time,
        request,
        response: harResponse,
        cache: {},
        timings: { send: 0, wait: response.time, receive: 0 },
        ...(response.requestId ? { _requestId: response.requestId } : {}),
        ...(response.error ? { _error: response.error } : {}),
    };
}

function headerList(source: Headers | InternalRequestConfig['headers'], redactList: readonly string[] | null): HarNameValue[] {
    const result: HarNameValue[] = [];
    for (const [name, value] of NeutrxHeaders.from(source)) {
        const redact = redactList?.includes(name.toLowerCase()) ?? false;
        result.push({ name, value: redact ? REDACTION : headerToString(value) });
    }
    return result;
}

function queryString(url: string): HarNameValue[] {
    try {
        const result: HarNameValue[] = [];
        for (const [name, value] of new URL(url).searchParams) result.push({ name, value });
        return result;
    } catch {
        return [];
    }
}

function postData(config: InternalRequestConfig): { postData: HarPostData } | Record<string, never> {
    if (config.data === undefined || config.data === null) return {};
    return {
        postData: {
            mimeType: headerToString(findHeader(NeutrxHeaders.from(config.headers).toJSON(), 'content-type')) || 'application/octet-stream',
            text: serializeBody(config.data),
        },
    };
}

function responseContent(data: ParsedResponseData, headers: Headers, include: boolean): HarContent {
    const mimeType = headerToString(findHeader(headers, 'content-type')) || 'application/octet-stream';
    if (!include) return { size: -1, mimeType };
    if (Buffer.isBuffer(data)) {
        const text = data.toString('base64');
        return { size: data.byteLength, mimeType, text, encoding: 'base64' };
    }
    if (data instanceof Uint8Array) {
        const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        return { size: buffer.byteLength, mimeType, text: buffer.toString('base64'), encoding: 'base64' };
    }
    const text = serializeBody(data);
    return { size: Buffer.byteLength(text), mimeType, text };
}

function serializeBody(data: RequestBody | ParsedResponseData): string {
    if (typeof data === 'string') return data;
    if (data === null || data === undefined) return '';
    if (Buffer.isBuffer(data)) return data.toString('base64');
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString('base64');
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');
    if (data instanceof URLSearchParams) return data.toString();
    const candidate = data as { readonly pipe?: unknown; readonly append?: unknown; readonly size?: unknown };
    if (typeof candidate.pipe === 'function') return '[stream]';
    if (typeof candidate.append === 'function') return '[form-data]';
    if (typeof candidate.size === 'number' && typeof (data as { readonly arrayBuffer?: unknown }).arrayBuffer === 'function') {
        return `[blob:${String(candidate.size)}]`;
    }
    try {
        return JSON.stringify(data);
    } catch {
        return '[unserializable]';
    }
}

function findHeader(headers: Headers, name: string): HeaderValue | undefined {
    const lower = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === lower) return value;
    }
    return undefined;
}

function errorConfig(error: Error): InternalRequestConfig | undefined {
    const candidate = error as { readonly config?: unknown; readonly response?: { readonly config?: unknown } };
    return asRequestConfig(candidate.config) ?? asRequestConfig(candidate.response?.config);
}

function asRequestConfig(config: unknown): InternalRequestConfig | undefined {
    if (config !== null && typeof config === 'object' && 'url' in config && 'method' in config) {
        return config as InternalRequestConfig;
    }
    return undefined;
}

function errorDuration(error: Error): number {
    if (isNeutrxError(error) && typeof error.duration === 'number') return error.duration;
    const candidate = error as { readonly duration?: unknown };
    return typeof candidate.duration === 'number' ? candidate.duration : 0;
}

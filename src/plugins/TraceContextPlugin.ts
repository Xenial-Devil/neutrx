import { NeutrxHeaders } from '../core/headers.js';
import type {
    HeaderValue,
    InternalRequestConfig,
    TraceContext,
    TraceContextPluginOptions,
    TracePropagationFormat,
} from '../types.js';
import { VERSION } from '../version.js';
import type { NeutrxPlugin } from './PluginManager.js';

export type { TraceContext, TraceContextPluginOptions, TracePropagationFormat } from '../types.js';

type BeforeRequestResult = Omit<InternalRequestConfig, 'headers'> & { readonly headers: NeutrxHeaders };
type RandomCrypto = { getRandomValues<TValue extends Uint8Array>(array: TValue): TValue };
type NormalizedTraceContext = Required<Pick<TraceContext, 'traceId' | 'spanId' | 'sampled'>> & {
    readonly parentSpanId?: string;
    readonly tracestate?: string;
};
type NormalizedTracePropagationFormat = 'w3c' | 'b3-multi' | 'b3-single';

const DEFAULT_FORMATS: readonly NormalizedTracePropagationFormat[] = ['w3c'];
const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/iu;

export function createTraceContextPlugin(options: TraceContextPluginOptions = {}): NeutrxPlugin {
    const formats = normalizeFormats(options.formats);

    return {
        name: 'trace-context',
        version: VERSION,

        install(client) {
            client.addPluginHook('beforeRequest', (config): BeforeRequestResult => {
                const headers = NeutrxHeaders.from(config.headers);
                const context = buildTraceContext(config, headers, options);
                for (const [name, value] of traceHeaders(context, formats)) {
                    if (options.overwrite === true) headers.set(name, value);
                    else headers.setIfUnset(name, value);
                }

                return { ...config, headers };
            });
        },
    };
}

export const TraceContextPlugin: NeutrxPlugin = createTraceContextPlugin();

function buildTraceContext(
    config: InternalRequestConfig,
    headers: NeutrxHeaders,
    options: TraceContextPluginOptions
): NormalizedTraceContext {
    const existing = extractTraceContext(headers);
    const configured = resolveConfiguredContext(config, options);
    const traceId = normalizeTraceId(configured.traceId) ?? existing?.traceId ?? randomTraceId();
    const spanId = normalizeSpanId(configured.spanId) ?? existing?.spanId ?? randomSpanId();
    const parentSpanId = normalizeSpanId(configured.parentSpanId) ?? existing?.parentSpanId;
    const tracestate = validTracestate(configured.tracestate)
        ?? validTracestate(resolveTracestate(config, options))
        ?? existing?.tracestate;

    return {
        traceId,
        spanId,
        sampled: configured.sampled ?? existing?.sampled ?? options.sampled ?? false,
        ...(parentSpanId ? { parentSpanId } : {}),
        ...(tracestate ? { tracestate } : {}),
    };
}

function resolveConfiguredContext(config: InternalRequestConfig, options: TraceContextPluginOptions): TraceContext {
    const context = typeof options.context === 'function' ? options.context(config) : options.context;
    return context ?? {};
}

function resolveTracestate(config: InternalRequestConfig, options: TraceContextPluginOptions): string | undefined {
    return typeof options.tracestate === 'function' ? options.tracestate(config) : options.tracestate;
}

function traceHeaders(
    context: NormalizedTraceContext,
    formats: readonly NormalizedTracePropagationFormat[]
): ReadonlyArray<readonly [string, string]> {
    const entries: Array<readonly [string, string]> = [];
    for (const format of formats) {
        if (format === 'w3c') {
            entries.push(['traceparent', traceparent(context)]);
            if (context.tracestate) entries.push(['tracestate', context.tracestate]);
            continue;
        }

        if (format === 'b3-multi') {
            entries.push(['X-B3-TraceId', context.traceId]);
            entries.push(['X-B3-SpanId', context.spanId]);
            entries.push(['X-B3-Sampled', sampledValue(context.sampled)]);
            continue;
        }

        entries.push(['b3', b3Single(context)]);
    }
    return entries;
}

function traceparent(context: NormalizedTraceContext): string {
    return `00-${context.traceId}-${context.spanId}-${context.sampled ? '01' : '00'}`;
}

function b3Single(context: NormalizedTraceContext): string {
    const sampled = sampledValue(context.sampled);
    return context.parentSpanId
        ? `${context.traceId}-${context.spanId}-${sampled}-${context.parentSpanId}`
        : `${context.traceId}-${context.spanId}-${sampled}`;
}

function sampledValue(sampled: boolean): string {
    return sampled ? '1' : '0';
}

function extractTraceContext(headers: NeutrxHeaders): TraceContext | undefined {
    return parseTraceparent(headerString(headers.get('traceparent')), headerString(headers.get('tracestate')))
        ?? parseB3Single(headerString(headers.get('b3')))
        ?? parseB3Multi(headers);
}

function parseTraceparent(value: string | undefined, tracestate: string | undefined): TraceContext | undefined {
    if (!value) return undefined;
    const match = TRACEPARENT_RE.exec(value);
    if (!match) return undefined;
    const traceId = normalizeTraceId(match[2]);
    const spanId = normalizeSpanId(match[3]);
    if (!traceId || !spanId) return undefined;
    const flags = Number.parseInt(match[4] ?? '0', 16);
    const state = validTracestate(tracestate);
    return {
        traceId,
        spanId,
        sampled: Number.isFinite(flags) && flags % 2 === 1,
        ...(state ? { tracestate: state } : {}),
    };
}

function parseB3Single(value: string | undefined): TraceContext | undefined {
    if (!value) return undefined;
    const parts = value.split('-');
    if (parts.length < 2) return undefined;

    const traceId = normalizeTraceId(parts[0]);
    const spanId = normalizeSpanId(parts[1]);
    if (!traceId || !spanId) return undefined;

    const sampled = parseB3Sampled(parts[2]);
    const parentSpanId = normalizeSpanId(parts[3]);
    return {
        traceId,
        spanId,
        ...(sampled !== undefined ? { sampled } : {}),
        ...(parentSpanId ? { parentSpanId } : {}),
    };
}

function parseB3Multi(headers: NeutrxHeaders): TraceContext | undefined {
    const traceId = normalizeTraceId(headerString(headers.get('X-B3-TraceId')));
    const spanId = normalizeSpanId(headerString(headers.get('X-B3-SpanId')));
    if (!traceId || !spanId) return undefined;

    const sampled = parseB3Sampled(headerString(headers.get('X-B3-Sampled')));
    const parentSpanId = normalizeSpanId(headerString(headers.get('X-B3-ParentSpanId')));
    return {
        traceId,
        spanId,
        ...(sampled !== undefined ? { sampled } : {}),
        ...(parentSpanId ? { parentSpanId } : {}),
    };
}

function normalizeTraceId(value: string | undefined): string | undefined {
    const normalized = value?.toLowerCase();
    if (!normalized) return undefined;
    if (/^[0-9a-f]{16}$/u.test(normalized) && !isAllZero(normalized)) return normalized.padStart(32, '0');
    if (/^[0-9a-f]{32}$/u.test(normalized) && !isAllZero(normalized)) return normalized;
    return undefined;
}

function normalizeSpanId(value: string | undefined): string | undefined {
    const normalized = value?.toLowerCase();
    return normalized && /^[0-9a-f]{16}$/u.test(normalized) && !isAllZero(normalized)
        ? normalized
        : undefined;
}

function parseB3Sampled(value: string | undefined): boolean | undefined {
    if (value === undefined || value === '') return undefined;
    const normalized = value.toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'd') return true;
    if (normalized === '0' || normalized === 'false') return false;
    return undefined;
}

function validTracestate(value: string | undefined): string | undefined {
    if (!value || value.length > 512 || /[\r\n]/u.test(value)) return undefined;
    return value;
}

function normalizeFormats(value: TraceContextPluginOptions['formats']): readonly NormalizedTracePropagationFormat[] {
    const formats: readonly TracePropagationFormat[] = value === undefined
        ? DEFAULT_FORMATS
        : isFormatArray(value) ? value : [value];
    const normalized = new Set<NormalizedTracePropagationFormat>();
    for (const format of formats) normalized.add(normalizeFormat(format));
    return normalized.size > 0 ? [...normalized] : DEFAULT_FORMATS;
}

function isFormatArray(value: TraceContextPluginOptions['formats']): value is readonly TracePropagationFormat[] {
    return Array.isArray(value);
}

function normalizeFormat(format: TracePropagationFormat): NormalizedTracePropagationFormat {
    if (format === 'b3' || format === 'b3single' || format === 'b3-single') return 'b3-single';
    if (format === 'b3multi' || format === 'b3-multi') return 'b3-multi';
    return 'w3c';
}

function randomTraceId(): string {
    return randomHex(16);
}

function randomSpanId(): string {
    return randomHex(8);
}

function randomHex(byteLength: number): string {
    const bytes = new Uint8Array(byteLength);
    const crypto = (globalThis as { readonly crypto?: RandomCrypto }).crypto;
    if (crypto) crypto.getRandomValues(bytes);
    else fillMathRandom(bytes);
    if (bytes.every(byte => byte === 0)) bytes[bytes.length - 1] = 1;
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function fillMathRandom(bytes: Uint8Array): void {
    for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
    }
}

function isAllZero(value: string): boolean {
    return /^0+$/u.test(value);
}

function headerString(value: HeaderValue | undefined): string | undefined {
    if (value === undefined || value === false) return undefined;
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
}

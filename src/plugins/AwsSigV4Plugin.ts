import crypto from 'node:crypto';

import { NeutrxHeaders, headerToString } from '../core/headers.js';
import type { HeaderValue, InternalRequestConfig, RequestBody } from '../types.js';
import { VERSION } from '../version.js';
import type { NeutrxPlugin } from './PluginManager.js';

const ALGORITHM = 'AWS4-HMAC-SHA256';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
const EMPTY_PAYLOAD_HASH = crypto.createHash('sha256').update('').digest('hex');
const UNRESERVED = /^[A-Za-z0-9_.~-]$/u;

/** Static or dynamically-resolved AWS credentials. */
export interface AwsCredentials {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly sessionToken?: string;
}

export type AwsCredentialsProvider = AwsCredentials | (() => AwsCredentials | Promise<AwsCredentials>);

export interface AwsSigV4PluginOptions {
    /** AWS region, e.g. `us-east-1`. */
    readonly region: string;
    /** AWS service name, e.g. `s3`, `execute-api`, `iam`. */
    readonly service: string;
    /** Static credentials or a (possibly async) provider resolved per request. */
    readonly credentials: AwsCredentialsProvider;
    /** Send `UNSIGNED-PAYLOAD` instead of hashing the body (common for S3 over HTTPS). */
    readonly unsignedPayload?: boolean;
    /** URI-encode each path segment twice. Defaults to `true` for every service except `s3`. */
    readonly doubleEncodePath?: boolean;
    /** Add and sign the `X-Amz-Content-Sha256` header. Defaults to `true` for `s3`. */
    readonly addContentSha256Header?: boolean;
    /** Clock override for deterministic signing in tests. */
    readonly now?: () => Date;
}

type BeforeRequestResult = Omit<InternalRequestConfig, 'headers'> & { readonly headers: NeutrxHeaders };
type ResolvedBody = { readonly payloadHash: string; readonly data?: RequestBody; readonly contentType?: string };

/**
 * Signs every outgoing request with AWS Signature Version 4 (header signing).
 * Node-only: relies on `node:crypto` and a `Host` header the browser fetch layer cannot set.
 */
export function createAwsSigV4Plugin(options: AwsSigV4PluginOptions): NeutrxPlugin {
    const doubleEncode = options.doubleEncodePath ?? options.service !== 's3';
    const addContentHash = options.addContentSha256Header ?? options.service === 's3';
    const clock = options.now ?? ((): Date => new Date());

    return {
        name: 'aws-sigv4',
        version: VERSION,

        install(client) {
            client.addPluginHook('beforeRequest', (config): Promise<BeforeRequestResult> => sign(config));
        },
    };

    async function sign(config: InternalRequestConfig): Promise<BeforeRequestResult> {
        const credentials = typeof options.credentials === 'function'
            ? await options.credentials()
            : options.credentials;
        const url = new URL(config.url);
        const { amzDate, dateStamp } = amzDates(clock());
        const body = resolveBody(config, options.unsignedPayload === true);

        const headers = NeutrxHeaders.from(config.headers);
        headers.set('Host', url.host);
        headers.set('X-Amz-Date', amzDate);
        if (credentials.sessionToken) headers.set('X-Amz-Security-Token', credentials.sessionToken);
        if (body.contentType && !headers.has('Content-Type')) headers.set('Content-Type', body.contentType);
        if (addContentHash) headers.set('X-Amz-Content-Sha256', body.payloadHash);

        const signed = collectSignedHeaders(headers);
        const canonicalHeaders = signed.map(([name, value]) => `${name}:${value}\n`).join('');
        const signedHeaders = signed.map(([name]) => name).join(';');

        const canonicalRequest = [
            config.method,
            canonicalUri(url.pathname, doubleEncode),
            canonicalQuery(url.searchParams),
            canonicalHeaders,
            signedHeaders,
            body.payloadHash,
        ].join('\n');

        const scope = `${dateStamp}/${options.region}/${options.service}/aws4_request`;
        const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
        const signingKey = deriveSigningKey(credentials.secretAccessKey, dateStamp, options.region, options.service);
        const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

        headers.set(
            'Authorization',
            `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
        );

        const result: BeforeRequestResult = { ...config, headers };
        if (body.data !== undefined) (result as { data?: RequestBody }).data = body.data;
        return result;
    }
}

function collectSignedHeaders(headers: NeutrxHeaders): ReadonlyArray<readonly [string, string]> {
    const entries: Array<readonly [string, string]> = [];
    for (const [name, value] of headers) {
        const lower = name.toLowerCase();
        if (lower === 'host' || lower === 'content-type' || lower.startsWith('x-amz-')) {
            entries.push([lower, canonicalHeaderValue(value)]);
        }
    }
    return entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

function canonicalHeaderValue(value: HeaderValue): string {
    return headerToString(value).trim().replace(/\s+/gu, ' ');
}

function canonicalUri(pathname: string, doubleEncode: boolean): string {
    const path = pathname === '' ? '/' : pathname;
    const segments = path.split('/').map(segment => {
        const once = awsUriEncode(segment, false);
        return doubleEncode ? awsUriEncode(once, false) : once;
    });
    const joined = segments.join('/');
    return joined === '' ? '/' : joined;
}

function canonicalQuery(params: URLSearchParams): string {
    const pairs: Array<readonly [string, string]> = [];
    for (const [key, value] of params) pairs.push([awsUriEncode(key, true), awsUriEncode(value, true)]);
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    return pairs.map(([key, value]) => `${key}=${value}`).join('&');
}

function awsUriEncode(value: string, encodeSlash: boolean): string {
    let out = '';
    for (const char of value) {
        if (UNRESERVED.test(char)) {
            out += char;
        } else if (char === '/' && !encodeSlash) {
            out += '/';
        } else {
            for (const byte of Buffer.from(char, 'utf8')) {
                out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
            }
        }
    }
    return out;
}

function resolveBody(config: InternalRequestConfig, unsigned: boolean): ResolvedBody {
    const data: unknown = config.data;
    if (unsigned) return { payloadHash: UNSIGNED_PAYLOAD };
    if (data === undefined || data === null) return { payloadHash: EMPTY_PAYLOAD_HASH };
    if (typeof data === 'string') return { payloadHash: sha256Hex(data) };
    if (Buffer.isBuffer(data)) return { payloadHash: sha256Buffer(data) };
    if (data instanceof ArrayBuffer) return { payloadHash: sha256Buffer(Buffer.from(data)) };
    if (ArrayBuffer.isView(data)) return { payloadHash: sha256Buffer(Buffer.from(data.buffer, data.byteOffset, data.byteLength)) };
    if (data instanceof URLSearchParams) return { payloadHash: sha256Hex(data.toString()) };
    if (isUnhashableBody(data)) return { payloadHash: UNSIGNED_PAYLOAD };
    const json = JSON.stringify(data);
    return { payloadHash: sha256Hex(json), data: json, contentType: 'application/json' };
}

function isUnhashableBody(data: object): boolean {
    const candidate = data as { readonly pipe?: unknown; readonly append?: unknown; readonly arrayBuffer?: unknown };
    return typeof candidate.pipe === 'function'
        || typeof candidate.append === 'function'
        || typeof candidate.arrayBuffer === 'function';
}

function deriveSigningKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
    const kDate = crypto.createHmac('sha256', `AWS4${secretAccessKey}`).update(dateStamp, 'utf8').digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region, 'utf8').digest();
    const kService = crypto.createHmac('sha256', kRegion).update(service, 'utf8').digest();
    return crypto.createHmac('sha256', kService).update('aws4_request', 'utf8').digest();
}

function sha256Hex(value: string): string {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function sha256Buffer(value: Buffer): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function amzDates(date: Date): { readonly amzDate: string; readonly dateStamp: string } {
    const year = date.getUTCFullYear().toString().padStart(4, '0');
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const seconds = date.getUTCSeconds().toString().padStart(2, '0');
    const dateStamp = `${year}${month}${day}`;
    return { amzDate: `${dateStamp}T${hours}${minutes}${seconds}Z`, dateStamp };
}

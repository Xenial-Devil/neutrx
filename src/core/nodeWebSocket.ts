import http, { type ClientRequest, type IncomingHttpHeaders, type RequestOptions } from 'node:http';
import https from 'node:https';
import { createHash, randomBytes } from 'node:crypto';
import type { Duplex } from 'node:stream';

import type {
    InternalRequestConfig,
    NeutrxWebSocketMessage,
    NeutrxWebSocketOptions,
    NeutrxWSConnection,
} from '../types.js';
import { NeutrxSecurityError } from './NeutrxError.js';
import { NeutrxHeaders, headerToString, toOutgoingHeaders } from './headers.js';
import {
    WEB_SOCKET_CLOSED,
    WEB_SOCKET_CLOSING,
    WEB_SOCKET_CONNECTING,
    WEB_SOCKET_OPEN,
    canReconnect,
    closeEvent,
    dispatchMessage,
    errorEvent,
    httpUrlForWebSocket,
    normalizeWebSocketReconnect,
    openEvent,
    reconnectDelay,
    serializeWebSocketMessage,
} from './websocket.js';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const CLOSE_ABNORMAL = 1006;
const CLOSE_NORMAL = 1000;

type Frame = {
    readonly fin: boolean;
    readonly opcode: number;
    readonly payload: Buffer;
    readonly consumed: number;
};

export function createNodeWebSocketConnection<TMessage, TSend extends NeutrxWebSocketMessage>(
    config: InternalRequestConfig,
    options: NeutrxWebSocketOptions<TMessage, TSend>
): NeutrxWSConnection<TMessage, TSend> {
    return new NodeWebSocketConnection(config, options);
}

class NodeWebSocketConnection<TMessage, TSend extends NeutrxWebSocketMessage> implements NeutrxWSConnection<TMessage, TSend> {
    readonly url: string;
    #config: InternalRequestConfig;
    #options: NeutrxWebSocketOptions<TMessage, TSend>;
    #readyState = WEB_SOCKET_CONNECTING;
    #request: ClientRequest | undefined;
    #socket: Duplex | undefined;
    #buffer = Buffer.alloc(0);
    #closedByCaller = false;
    #closeNotified = false;
    #timer: ReturnType<typeof setTimeout> | undefined;
    #attempts = 0;
    #fragmentOpcode: number | undefined;
    #fragments: Buffer[] = [];

    constructor(config: InternalRequestConfig, options: NeutrxWebSocketOptions<TMessage, TSend>) {
        this.#config = config;
        this.#options = options;
        this.url = config.url;
        this.#connect();
    }

    get readyState(): number {
        return this.#readyState;
    }

    send(data: TSend): void {
        if (this.#readyState !== WEB_SOCKET_OPEN || !this.#socket) {
            throw new NeutrxSecurityError('WebSocket is not open', { code: 'WEBSOCKET_NOT_OPEN' });
        }
        this.#socket.write(encodeClientFrame(serializeWebSocketMessage(this.#options, data)));
    }

    close(code = CLOSE_NORMAL, reason = ''): void {
        this.#closedByCaller = true;
        if (this.#timer) clearTimeout(this.#timer);
        if (this.#readyState === WEB_SOCKET_OPEN && this.#socket) {
            this.#readyState = WEB_SOCKET_CLOSING;
            this.#socket.write(encodeCloseFrame(code, reason), () => this.#socket?.end());
            return;
        }
        this.#request?.destroy();
        this.#socket?.destroy();
        this.#notifyClose(code, reason, true);
    }

    #connect(): void {
        const requestUrl = new URL(httpUrlForWebSocket(this.url));
        const secure = requestUrl.protocol === 'https:';
        const key = randomBytes(16).toString('base64');
        const headers = this.#handshakeHeaders(requestUrl, key);
        const requestOptions = this.#requestOptions(requestUrl, headers, secure);
        const request = (secure ? https : http).request(requestOptions);
        this.#request = request;
        this.#readyState = WEB_SOCKET_CONNECTING;
        this.#closeNotified = false;

        const abort = (): void => {
            this.#closedByCaller = true;
            request.destroy(new Error('WebSocket connection aborted'));
        };

        if (this.#config.signal?.aborted) {
            abort();
            return;
        }

        this.#config.signal?.addEventListener('abort', abort, { once: true });
        request.setTimeout(this.#config.connectTimeout, () => {
            request.destroy(new Error(`WebSocket connect timeout after ${this.#config.connectTimeout}ms`));
        });

        request.once('upgrade', (response, socket, head) => {
            this.#config.signal?.removeEventListener('abort', abort);
            this.#request = undefined;
            if (!this.#isValidUpgrade(response.headers, key)) {
                socket.destroy();
                this.#handleError(new NeutrxSecurityError('Invalid WebSocket upgrade response', { code: 'WEBSOCKET_UPGRADE_FAILED' }));
                return;
            }

            this.#socket = socket;
            this.#readyState = WEB_SOCKET_OPEN;
            this.#attempts = 0;
            socket.on('data', chunk => this.#handleData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            socket.once('close', () => this.#notifyClose(CLOSE_ABNORMAL, '', false));
            socket.on('error', error => this.#handleError(error));
            if (typeof (socket as { readonly setNoDelay?: unknown }).setNoDelay === 'function') {
                (socket as { setNoDelay(value?: boolean): void }).setNoDelay(true);
            }
            if (head.length > 0) this.#handleData(head);
            this.#options.onOpen?.(openEvent(this.url));
        });

        request.once('response', response => {
            response.resume();
            this.#handleError(new NeutrxSecurityError(`WebSocket upgrade failed with HTTP ${response.statusCode ?? 0}`, { code: 'WEBSOCKET_UPGRADE_FAILED' }));
        });

        request.once('error', error => {
            this.#config.signal?.removeEventListener('abort', abort);
            this.#handleError(error);
            this.#notifyClose(CLOSE_ABNORMAL, '', false);
        });

        request.end();
    }

    #handshakeHeaders(url: URL, key: string): NeutrxHeaders {
        const headers = NeutrxHeaders.from(this.#config.headers);
        headers.set('Host', url.host);
        headers.set('Upgrade', 'websocket');
        headers.set('Connection', 'Upgrade');
        headers.set('Sec-WebSocket-Key', key);
        headers.set('Sec-WebSocket-Version', '13');
        const protocols = protocolHeader(this.#options.protocols);
        if (protocols) headers.set('Sec-WebSocket-Protocol', protocols);
        headers.delete('Content-Length');
        headers.delete('Transfer-Encoding');
        return headers;
    }

    #requestOptions(url: URL, headers: NeutrxHeaders, secure: boolean): RequestOptions {
        return {
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port,
            path: `${url.pathname}${url.search}`,
            method: 'GET',
            headers: toOutgoingHeaders(headers),
            ...(this.#config.socketPath ? { socketPath: this.#config.socketPath } : {}),
            ...(this.#config.lookup ? { lookup: this.#config.lookup } : {}),
            ...(secure && this.#config.httpsAgent ? { agent: this.#config.httpsAgent } : {}),
            ...(!secure && this.#config.httpAgent ? { agent: this.#config.httpAgent } : {}),
            ...(secure && this.#config.tls?.ca !== undefined ? { ca: this.#config.tls.ca } : {}),
            ...(secure && this.#config.tls?.cert !== undefined ? { cert: this.#config.tls.cert } : {}),
            ...(secure && this.#config.tls?.key !== undefined ? { key: this.#config.tls.key } : {}),
            ...(secure && this.#config.tls?.pfx !== undefined ? { pfx: this.#config.tls.pfx } : {}),
            ...(secure && this.#config.tls?.passphrase !== undefined ? { passphrase: this.#config.tls.passphrase } : {}),
            ...(secure && this.#config.tls?.servername !== undefined ? { servername: this.#config.tls.servername } : {}),
            ...(secure && this.#config.tls?.rejectUnauthorized !== undefined ? { rejectUnauthorized: this.#config.tls.rejectUnauthorized } : {}),
        };
    }

    #isValidUpgrade(headers: IncomingHttpHeaders, key: string): boolean {
        const accept = headerToString(headers['sec-websocket-accept']);
        if (accept !== createAcceptKey(key)) return false;
        const upgrade = headerToString(headers.upgrade).toLowerCase();
        if (upgrade !== 'websocket') return false;

        const requestedProtocols = protocolList(this.#options.protocols);
        const selectedProtocol = headerToString(headers['sec-websocket-protocol']).trim();
        return !selectedProtocol || requestedProtocols.length === 0 || requestedProtocols.includes(selectedProtocol);
    }

    #handleData(chunk: Buffer): void {
        this.#buffer = Buffer.concat([this.#buffer, chunk]);
        while (this.#buffer.length > 0) {
            const frame = readFrame(this.#buffer);
            if (!frame) return;
            this.#buffer = this.#buffer.subarray(frame.consumed);
            this.#handleFrame(frame);
        }
    }

    #handleFrame(frame: Frame): void {
        if (frame.opcode === 0x8) {
            const { code, reason } = parseClosePayload(frame.payload);
            if (this.#readyState === WEB_SOCKET_OPEN) {
                this.#readyState = WEB_SOCKET_CLOSING;
                this.#socket?.write(encodeCloseFrame(code, reason), () => this.#socket?.end());
            }
            this.#notifyClose(code, reason, true);
            return;
        }

        if (frame.opcode === 0x9) {
            this.#socket?.write(encodeFrame(frame.payload, 0xA, true));
            return;
        }

        if (frame.opcode === 0xA) return;

        if (frame.opcode === 0x0) {
            if (this.#fragmentOpcode === undefined) return;
            this.#fragments.push(frame.payload);
            if (frame.fin) {
                const payload = Buffer.concat(this.#fragments);
                const opcode = this.#fragmentOpcode;
                this.#fragmentOpcode = undefined;
                this.#fragments = [];
                this.#dispatchPayload(opcode, payload);
            }
            return;
        }

        if (!frame.fin) {
            this.#fragmentOpcode = frame.opcode;
            this.#fragments = [frame.payload];
            return;
        }

        this.#dispatchPayload(frame.opcode, frame.payload);
    }

    #dispatchPayload(opcode: number, payload: Buffer): void {
        if (opcode === 0x1) {
            dispatchMessage(this.#options, payload.toString('utf8'));
            return;
        }
        if (opcode === 0x2) {
            dispatchMessage(this.#options, new Uint8Array(payload));
        }
    }

    #handleError(error: Error): void {
        if (!this.#closedByCaller) this.#options.onError?.(errorEvent(error));
    }

    #notifyClose(code: number, reason: string, wasClean: boolean): void {
        if (this.#closeNotified) return;
        this.#closeNotified = true;
        this.#readyState = WEB_SOCKET_CLOSED;
        this.#request = undefined;
        this.#socket = undefined;
        this.#options.onClose?.(closeEvent(code, reason, wasClean));
        this.#scheduleReconnect();
    }

    #scheduleReconnect(): void {
        const reconnect = normalizeWebSocketReconnect(this.#options.reconnect);
        if (this.#closedByCaller || !canReconnect(reconnect, this.#attempts)) return;
        const delay = reconnectDelay(reconnect, this.#attempts + 1);
        this.#attempts += 1;
        this.#timer = setTimeout(() => {
            this.#buffer = Buffer.alloc(0);
            this.#fragmentOpcode = undefined;
            this.#fragments = [];
            this.#connect();
        }, delay);
    }
}

function createAcceptKey(key: string): string {
    return createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
}

function protocolHeader(protocols: string | readonly string[] | undefined): string | undefined {
    const values = protocolList(protocols);
    return values.length > 0 ? values.join(', ') : undefined;
}

function protocolList(protocols: string | readonly string[] | undefined): string[] {
    const values = typeof protocols === 'string' ? [protocols] : [...(protocols ?? [])];
    return values.map(protocol => protocol.trim()).filter(Boolean);
}

function readFrame(buffer: Buffer): Frame | null {
    if (buffer.length < 2) return null;
    const first = buffer[0] ?? 0;
    const second = buffer[1] ?? 0;
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;

    if (length === 126) {
        if (buffer.length < offset + 2) return null;
        length = buffer.readUInt16BE(offset);
        offset += 2;
    } else if (length === 127) {
        if (buffer.length < offset + 8) return null;
        const bigLength = buffer.readBigUInt64BE(offset);
        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new NeutrxSecurityError('WebSocket frame too large', { code: 'WEBSOCKET_FRAME_TOO_LARGE' });
        }
        length = Number(bigLength);
        offset += 8;
    }

    const maskOffset = offset;
    if (masked) offset += 4;
    if (buffer.length < offset + length) return null;

    const payload = Buffer.from(buffer.subarray(offset, offset + length));
    if (masked) {
        const mask = buffer.subarray(maskOffset, maskOffset + 4);
        for (let index = 0; index < payload.length; index += 1) {
            payload[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
        }
    }

    return { fin, opcode, payload, consumed: offset + length };
}

function encodeClientFrame(data: NeutrxWebSocketMessage): Buffer {
    if (typeof data === 'string') return encodeFrame(Buffer.from(data), 0x1, true);
    if (data instanceof ArrayBuffer) return encodeFrame(Buffer.from(data), 0x2, true);
    if (ArrayBuffer.isView(data)) {
        return encodeFrame(Buffer.from(data.buffer, data.byteOffset, data.byteLength), 0x2, true);
    }
    throw new NeutrxSecurityError('Node WebSocket send does not support Blob payloads', { code: 'WEBSOCKET_UNSUPPORTED_MESSAGE' });
}

function encodeCloseFrame(code: number, reason: string): Buffer {
    const reasonBuffer = Buffer.from(reason);
    const payload = Buffer.alloc(2 + reasonBuffer.length);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);
    return encodeFrame(payload, 0x8, true);
}

function encodeFrame(payload: Buffer, opcode: number, masked: boolean): Buffer {
    const lengthBytes = payload.length < 126 ? 0 : payload.length <= 0xffff ? 2 : 8;
    const header = Buffer.alloc(2 + lengthBytes + (masked ? 4 : 0));
    header[0] = 0x80 | opcode;
    if (payload.length < 126) {
        header[1] = payload.length | (masked ? 0x80 : 0);
    } else if (payload.length <= 0xffff) {
        header[1] = 126 | (masked ? 0x80 : 0);
        header.writeUInt16BE(payload.length, 2);
    } else {
        header[1] = 127 | (masked ? 0x80 : 0);
        header.writeBigUInt64BE(BigInt(payload.length), 2);
    }

    if (!masked) return Buffer.concat([header, payload]);

    const mask = randomBytes(4);
    mask.copy(header, 2 + lengthBytes);
    const maskedPayload = Buffer.from(payload);
    for (let index = 0; index < maskedPayload.length; index += 1) {
        maskedPayload[index] = (maskedPayload[index] ?? 0) ^ (mask[index % 4] ?? 0);
    }
    return Buffer.concat([header, maskedPayload]);
}

function parseClosePayload(payload: Buffer): { readonly code: number; readonly reason: string } {
    if (payload.length < 2) return { code: CLOSE_NORMAL, reason: '' };
    return {
        code: payload.readUInt16BE(0),
        reason: payload.subarray(2).toString('utf8'),
    };
}

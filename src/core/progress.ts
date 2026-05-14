import type { IncomingMessage } from 'node:http';

import type { InternalRequestConfig, ProgressEvent } from '../types.js';
import { getContentLength, normalizeIncomingHeaders } from './headers.js';

export function reportUploadProgress(config: InternalRequestConfig, loaded: number, total?: number): void {
    reportProgress(config.onUploadProgress, loaded, total);
}

export function reportDownloadProgress(config: InternalRequestConfig, loaded: number, total?: number): void {
    reportProgress(config.onDownloadProgress, loaded, total);
}

export function attachStreamDownloadProgress(response: IncomingMessage, config: InternalRequestConfig): void {
    if (!config.onDownloadProgress) return;

    const total = getContentLength(normalizeIncomingHeaders(response.headers));
    let loaded = 0;
    reportDownloadProgress(config, loaded, total);
    response.on('data', chunk => {
        loaded += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
        reportDownloadProgress(config, loaded, total);
    });
}

export function toUploadBuffer(chunk: unknown): Buffer {
    if (Buffer.isBuffer(chunk)) return chunk;
    if (typeof chunk === 'string') return Buffer.from(chunk);
    if (chunk instanceof Uint8Array) return Buffer.from(chunk);
    return Buffer.from(String(chunk));
}

function reportProgress(callback: ((event: ProgressEvent) => void) | undefined, loaded: number, total?: number): void {
    if (!callback) return;
    if (total !== undefined && total > 0) {
        callback({ loaded, total, percent: Math.min(100, Number(((loaded / total) * 100).toFixed(2))) });
        return;
    }
    callback({ loaded });
}

import type { IncomingMessage } from 'node:http';

import type { InternalRequestConfig, ProgressEvent } from '../types.js';
import { getContentLength, normalizeIncomingHeaders } from './headers.js';

type ProgressDirection = 'upload' | 'download';
type ProgressState = { readonly loaded: number; readonly timestamp: number };

const uploadState = new WeakMap<InternalRequestConfig, ProgressState>();
const downloadState = new WeakMap<InternalRequestConfig, ProgressState>();

export function reportUploadProgress(config: InternalRequestConfig, loaded: number, total?: number): void {
    reportProgress(config, 'upload', config.onUploadProgress, loaded, total);
}

export function reportDownloadProgress(config: InternalRequestConfig, loaded: number, total?: number): void {
    reportProgress(config, 'download', config.onDownloadProgress, loaded, total);
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

function reportProgress(
    config: InternalRequestConfig,
    direction: ProgressDirection,
    callback: ((event: ProgressEvent) => void) | undefined,
    loaded: number,
    total?: number
): void {
    if (!callback) return;
    const stateMap = direction === 'upload' ? uploadState : downloadState;
    const previous = stateMap.get(config);
    const now = Date.now();
    const bytes = Math.max(0, loaded - (previous?.loaded ?? 0));
    const elapsedMs = Math.max(1, now - (previous?.timestamp ?? now));
    const rate = previous ? Math.round((bytes * 1000) / elapsedMs) : 0;
    const event: ProgressEvent = {
        loaded,
        bytes,
        rate,
        ...(direction === 'upload' ? { upload: true as const } : { download: true as const }),
        ...(total !== undefined ? { total } : {}),
        ...(total !== undefined && total > 0 ? { percent: Math.min(100, Number(((loaded / total) * 100).toFixed(2))) } : {}),
        ...(total !== undefined && total > 0 ? { progress: Math.min(1, Number((loaded / total).toFixed(4))) } : {}),
        ...(total !== undefined && rate > 0 ? { estimated: Number(((Math.max(0, total - loaded)) / rate).toFixed(3)) } : {}),
    };
    stateMap.set(config, { loaded, timestamp: now });
    callback(event);
}

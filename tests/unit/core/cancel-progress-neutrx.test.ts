import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { IncomingMessage } from 'node:http';
import type * as CancelModule from '../../../src/core/cancel.js';
import type * as ProgressModule from '../../../src/core/progress.js';
import type * as PackageEntry from '../../../src/index.js';
import type * as ProfilesModule from '../../../src/security/profiles.js';
import type { InternalRequestConfig, RawHttpResponse, RequestBody } from '../../../src/types.js';

const cancelEntry = '../../../../dist/core/cancel.mjs';
const progressEntry = '../../../../dist/core/progress.mjs';
const builtEntry = '../../../../dist/index.mjs';
const profilesEntry = '../../../../dist/security/profiles.mjs';

void test('cancel token covers executor, merge, and abort helpers', async () => {
    const { Cancel, CancelToken, abortError, isCancel, mergeCancellationSignal } = await import(cancelEntry) as typeof CancelModule;
    const immediate = new CancelToken(cancel => {
        cancel('now');
        cancel('ignored');
    });

    assert.equal(immediate.reason?.message, 'now');
    assert.throws(() => immediate.throwIfRequested(), Cancel);
    assert.equal(immediate.toAbortSignal().aborted, true);
    assert.equal(isCancel(immediate.reason), true);
    assert.throws(() => new CancelToken(() => {
        throw new Error('executor boom');
    }), /executor boom/u);

    const source = CancelToken.source();
    const native = new AbortController();
    const merged = mergeCancellationSignal(native.signal, source.token);
    assert.ok(merged);
    source.cancel('legacy cancel');
    await source.token.promise;
    await tick();
    assert.equal(merged.aborted, true);
    assert.equal(abortError(merged).message, 'legacy cancel');

    const nativeOnly = new AbortController();
    assert.equal(mergeCancellationSignal(nativeOnly.signal, undefined), nativeOnly.signal);
    const nativeMerged = mergeCancellationSignal(nativeOnly.signal, CancelToken.source().token);
    nativeOnly.abort(new Error('native abort'));
    await tick();
    assert.equal(abortError(nativeMerged).message, 'native abort');
    assert.equal(mergeCancellationSignal(undefined, undefined), undefined);
    assert.equal(abortError().name, 'AbortError');
});

void test('progress helpers compute bytes/rate/progress and stream download events', async () => {
    const {
        attachStreamDownloadProgress,
        reportDownloadProgress,
        reportUploadProgress,
        toUploadBuffer,
    } = await import(progressEntry) as typeof ProgressModule;
    const uploads: PackageEntry.ProgressEvent[] = [];
    const downloads: PackageEntry.ProgressEvent[] = [];
    const config = requestConfig({
        onUploadProgress: event => uploads.push(event),
        onDownloadProgress: event => downloads.push(event),
    });

    reportUploadProgress(requestConfig(), 10, 100);
    const originalNow = Date.now;
    let now = 1_000;
    Date.now = () => now;
    try {
        reportUploadProgress(config, 0, 100);
        now = 1_500;
        reportUploadProgress(config, 40, 100);
    } finally {
        Date.now = originalNow;
    }
    reportDownloadProgress(config, 5);

    assert.equal(uploads[0]?.upload, true);
    assert.equal(uploads[1]?.bytes, 40);
    assert.equal(uploads[1]?.rate, 80);
    assert.equal(uploads[1]?.estimated, 0.75);
    assert.equal(uploads[1]?.percent, 40);
    assert.equal(uploads[1]?.progress, 0.4);
    assert.equal(downloads[0]?.download, true);
    assert.equal(downloads[0]?.bytes, 5);

    const stream = Readable.from(['he', Buffer.from('llo')]) as IncomingMessage;
    stream.headers = { 'content-length': '5' };
    attachStreamDownloadProgress(stream, config);
    stream.resume();
    await once(stream, 'end');

    assert.equal(downloads.at(-1)?.loaded, 5);
    assert.equal(downloads.at(-1)?.progress, 1);
    assert.equal(toUploadBuffer('x').toString(), 'x');
    assert.equal(toUploadBuffer(Buffer.from('y')).toString(), 'y');
    assert.equal(toUploadBuffer(new Uint8Array([122])).toString(), 'z');
    assert.equal(toUploadBuffer({ ok: true }).toString(), '[object Object]');
});

void test('root Neutrx proxy methods merge defaults for request/getUri/body helpers', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const previousDefaults = { ...Neutrx.defaults };
    const captured: string[] = [];
    const adapter = (config: InternalRequestConfig<RequestBody>): RawHttpResponse => {
        captured.push(`${config.method} ${config.url} ${String(config.headers['X-Root'] ?? '')}`);
        return {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(JSON.stringify({ method: config.method, url: config.url })),
            config,
        };
    };

    try {
        resetDefaults(Neutrx.defaults);
        Neutrx.defaults.baseURL = 'https://root.example/api';
        Neutrx.defaults.headers = { 'X-Root': 'yes' };
        Neutrx.defaults.security = { enforceHTTPS: true };
        Neutrx.defaults.resilience = { enableRetry: false };
        Neutrx.defaults.performance = { enableCaching: false };
        Neutrx.defaults.instrumentation = { openTelemetry: false };

        assert.equal(Reflect.has(Neutrx, 'get'), true);
        assert.ok(Reflect.ownKeys(Neutrx).includes('create'));
        assert.equal(Object.getOwnPropertyDescriptor(Neutrx, 'create')?.enumerable, true);

        await Neutrx.request({ url: '/request', adapter });
        await Neutrx.get('/get', { adapter });
        await Neutrx.post('/post', { ok: true }, { adapter });
        await Neutrx.putForm('/form', { ok: true }, { adapter });
        await Neutrx.download('/download', { adapter });

        assert.equal(Neutrx.getUri('/uri'), 'https://root.example/api/uri');
        assert.equal(Neutrx.getUri({ url: '/search', params: { q: 'one' } }), 'https://root.example/api/search?q=one');
        assert.deepEqual(captured, [
            'GET https://root.example/api/request yes',
            'GET https://root.example/api/get yes',
            'POST https://root.example/api/post yes',
            'PUT https://root.example/api/form yes',
            'GET https://root.example/api/download yes',
        ]);
    } finally {
        resetDefaults(Neutrx.defaults);
        Object.assign(Neutrx.defaults, previousDefaults);
    }
});

void test('security profile aliases normalize and unknown profile fails closed', async () => {
    const { normalizeSecurityProfile } = await import(profilesEntry) as typeof ProfilesModule;

    assert.equal(normalizeSecurityProfile(undefined), 'standard');
    assert.equal(normalizeSecurityProfile('balanced'), 'standard');
    assert.equal(normalizeSecurityProfile('standard'), 'standard');
    assert.equal(normalizeSecurityProfile('strict'), 'strict');
    assert.equal(normalizeSecurityProfile('legacy'), 'legacy');
    assert.throws(() => normalizeSecurityProfile('surprise' as never), /Unknown security profile/u);
});

function requestConfig(overrides: Partial<InternalRequestConfig> = {}): InternalRequestConfig {
    return {
        url: 'https://api.example.com',
        method: 'GET',
        headers: {} as InternalRequestConfig['headers'],
        allowAbsoluteUrls: true,
        timeout: 1000,
        connectTimeout: 1000,
        maxRedirects: 0,
        maxContentLength: 1024,
        maxBodyLength: 1024,
        responseType: 'json',
        responseEncoding: 'utf8',
        validateStatus: status => status >= 200 && status < 300,
        throwHttpErrors: true,
        decompress: true,
        transitional: { clarifyTimeoutError: false },
        followRedirects: true,
        requestId: 'req-1',
        startTime: Date.now(),
        hops: 0,
        ...overrides,
    };
}

function resetDefaults(defaults: Record<string, unknown>): void {
    for (const key of Object.keys(defaults)) delete defaults[key];
}

function tick(): Promise<void> {
    return new Promise(resolve => {
        setImmediate(resolve);
    });
}

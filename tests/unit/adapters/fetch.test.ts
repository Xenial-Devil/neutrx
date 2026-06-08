import assert from 'node:assert/strict';
import test from 'node:test';
import type * as FetchModule from '../../../src/adapters/fetch.js';
import type { InternalRequestConfig, ProgressEvent, RequestBody } from '../../../src/types.js';

const fetchEntry = '../../../../dist/adapters/fetch.mjs';

type BrowserGlobal = typeof globalThis & {
    window?: unknown;
    document?: { cookie: string };
    location?: { href: string; origin: string };
};

void test('fetch adapter honors credentials, custom fetch, timeout signal, and XSRF', async () => {
    const { fetchAdapter } = await import(fetchEntry) as typeof FetchModule;
    const browserGlobal = globalThis as BrowserGlobal;
    browserGlobal.window = browserGlobal;
    browserGlobal.document = { cookie: 'XSRF-TOKEN=abc123' };
    browserGlobal.location = { href: 'https://app.example/current', origin: 'https://app.example' };

    let captured: RequestInit | undefined;
    const customFetch: typeof fetch = (_url, init) => {
        captured = init;
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json', 'content-length': '11' },
        }));
    };

    const raw = await fetchAdapter({
        url: 'https://app.example/api',
        method: 'GET',
        headers: {} as InternalRequestConfig['headers'],
        allowAbsoluteUrls: true,
        timeout: 5000,
        connectTimeout: 5000,
        maxRedirects: 0,
        maxContentLength: 1024,
        maxBodyLength: 1024,
        responseType: 'json',
        responseEncoding: 'utf8',
        validateStatus: status => status < 500,
        throwHttpErrors: true,
        decompress: false,
        transitional: { clarifyTimeoutError: false },
        followRedirects: true,
        requestId: 'test',
        startTime: Date.now(),
        hops: 0,
        fetch: customFetch,
        withCredentials: true,
        xsrfCookieName: 'XSRF-TOKEN',
        xsrfHeaderName: 'X-XSRF-TOKEN',
    });

    assert.equal(raw.status, 200);
    assert.ok(raw.request instanceof Request);
    assert.equal(captured?.credentials, 'include');
    assert.equal(captured?.redirect, 'manual');
    assert.equal(new Headers(captured?.headers).get('X-XSRF-TOKEN'), 'abc123');
});

void test('fetch adapter serializes bodies and reports upload/download progress', async () => {
    const { fetchAdapter } = await import(fetchEntry) as typeof FetchModule;
    const uploads: ProgressEvent[] = [];
    const downloads: number[] = [];
    let captured: RequestInit | undefined;
    const customFetch: typeof fetch = (_url, init) => {
        captured = init;
        return Promise.resolve(new Response('payload', { status: 201, statusText: 'Created', headers: { 'content-length': '7' } }));
    };

    const raw = await fetchAdapter(config({
        data: { name: 'Ada' },
        method: 'POST',
        fetch: customFetch,
        onUploadProgress: event => uploads.push(event),
        onDownloadProgress: event => downloads.push(event.loaded),
        responseType: 'text',
    }));

    assert.equal(raw.status, 201);
    assert.deepEqual(raw.data, Buffer.from('payload'));
    assert.equal(captured?.method, 'POST');
    assert.equal(captured?.body, '{"name":"Ada"}');
    assert.deepEqual(uploads.map(event => event.loaded), [0, 14]);
    assert.deepEqual(uploads.map(event => event.bytes), [0, 14]);
    assert.deepEqual(uploads.map(event => event.percent), [0, 100]);
    assert.deepEqual(downloads, [0, 7]);
});

void test('fetch adapter reports progress for upload and download streams', async () => {
    const { fetchAdapter } = await import(fetchEntry) as typeof FetchModule;
    const encoder = new TextEncoder();
    const uploadEvents: ProgressEvent[] = [];
    const downloadEvents: ProgressEvent[] = [];
    const uploaded: Uint8Array[] = [];
    const uploadStream = new ReadableStream<Uint8Array>({
        start(controller): void {
            controller.enqueue(encoder.encode('hi'));
            controller.enqueue(encoder.encode('!'));
            controller.close();
        },
    });
    const downloadStream = new ReadableStream<Uint8Array>({
        start(controller): void {
            controller.enqueue(encoder.encode('ab'));
            controller.enqueue(encoder.encode('cde'));
            controller.close();
        },
    });

    const raw = await fetchAdapter(config({
        data: uploadStream as unknown as RequestBody,
        headers: { 'Content-Length': 3 } as unknown as InternalRequestConfig['headers'],
        method: 'POST',
        responseType: 'stream',
        fetch: async (_url, init) => {
            const body = init?.body as ReadableStream<Uint8Array>;
            const reader = body.getReader();
            let done = false;
            while (!done) {
                const read = await reader.read();
                done = read.done;
                if (read.value) uploaded.push(read.value);
            }
            return new Response(downloadStream, { headers: { 'content-length': '5' } });
        },
        onUploadProgress: event => uploadEvents.push(event),
        onDownloadProgress: event => downloadEvents.push(event),
    }));

    assert.ok(raw.data instanceof ReadableStream);
    const reader = raw.data.getReader();
    const downloaded: Uint8Array[] = [];
    let done = false;
    while (!done) {
        const read = await reader.read();
        done = read.done;
        if (read.value) downloaded.push(read.value);
    }

    assert.equal(new TextDecoder().decode(concatChunks(uploaded, 3)), 'hi!');
    assert.equal(new TextDecoder().decode(concatChunks(downloaded, 5)), 'abcde');
    assert.deepEqual(uploadEvents.map(event => event.loaded), [0, 2, 3]);
    assert.deepEqual(uploadEvents.map(event => event.bytes), [0, 2, 1]);
    assert.deepEqual(uploadEvents.map(event => event.total), [3, 3, 3]);
    assert.deepEqual(downloadEvents.map(event => event.loaded), [0, 2, 5]);
    assert.deepEqual(downloadEvents.map(event => event.bytes), [0, 2, 3]);
    assert.deepEqual(downloadEvents.map(event => event.percent), [0, 40, 100]);
});

void test('fetch adapter supports response body variants and maxContentLength errors', async () => {
    const { fetchAdapter } = await import(fetchEntry) as typeof FetchModule;
    const streamRaw = await fetchAdapter(config({
        fetch: () => Promise.resolve(new Response('streamed')),
        responseType: 'stream',
    }));
    assert.ok(streamRaw.data instanceof ReadableStream);

    const blobRaw = await fetchAdapter(config({
        fetch: () => Promise.resolve(new Response(new Blob(['blobbed'], { type: 'text/plain' }))),
        responseType: 'blob',
    }));
    assert.ok(blobRaw.data instanceof Blob);
    assert.equal(await blobRaw.data.text(), 'blobbed');

    const form = new FormData();
    form.set('name', 'Ada');
    const formRaw = await fetchAdapter(config({
        fetch: () => Promise.resolve(new Response(form)),
        responseType: 'formData',
    }));
    assert.ok(formRaw.data instanceof FormData);
    assert.equal(formRaw.data.get('name'), 'Ada');

    const arrayRaw = await fetchAdapter(config({
        fetch: () => Promise.resolve(new Response('abc')),
        responseType: 'arrayBuffer',
    }));
    assert.equal((arrayRaw.data as ArrayBuffer).byteLength, 3);

    await assert.rejects(
        async () => fetchAdapter(config({
            fetch: () => Promise.resolve(new Response('too large')),
            maxContentLength: 3,
        })),
        /Response size/u
    );
});

void test('fetch adapter propagates caller abort reason and handles body pass-throughs', async () => {
    const { fetchAdapter } = await import(fetchEntry) as typeof FetchModule;
    const controller = new AbortController();
    controller.abort(new Error('caller abort'));

    await assert.rejects(
        async () => fetchAdapter(config({
            signal: controller.signal,
            fetch: () => Promise.reject(new Error('unreachable')),
        })),
        /caller abort/u
    );

    const bodies: unknown[] = [];
    const customFetch: typeof fetch = (_url, init) => {
        bodies.push(init?.body);
        return Promise.resolve(new Response(''));
    };

    await fetchAdapter(config({ data: Buffer.from('buf'), method: 'POST', fetch: customFetch }));
    await fetchAdapter(config({ data: new URLSearchParams({ q: '1' }), method: 'POST', fetch: customFetch }));
    await fetchAdapter(config({ data: new Blob(['blob']), method: 'POST', fetch: customFetch }));

    assert.ok(Buffer.isBuffer(bodies[0]));
    assert.ok(bodies[1] instanceof URLSearchParams);
    assert.ok(bodies[2] instanceof Blob);
});

void test('fetch adapter combines caller and timeout signals without AbortSignal.any', async () => {
    const { fetchAdapter } = await import(fetchEntry) as typeof FetchModule;
    const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
    assert.ok(!anyDescriptor || anyDescriptor.configurable);

    Object.defineProperty(AbortSignal, 'any', {
        configurable: true,
        value: undefined,
    });

    try {
        const controller = new AbortController();
        controller.abort(new Error('legacy abort'));

        await assert.rejects(
            async () => fetchAdapter(config({
                signal: controller.signal,
                fetch: () => Promise.reject(new Error('unreachable')),
            })),
            /legacy abort/u
        );
    } finally {
        if (anyDescriptor) Object.defineProperty(AbortSignal, 'any', anyDescriptor);
        else delete (AbortSignal as { any?: unknown }).any;
    }
});

function config(overrides: Partial<InternalRequestConfig<RequestBody>> = {}): InternalRequestConfig<RequestBody> {
    return {
        url: 'https://app.example/api',
        method: 'GET',
        headers: {} as InternalRequestConfig<RequestBody>['headers'],
        allowAbsoluteUrls: true,
        timeout: 5000,
        connectTimeout: 5000,
        maxRedirects: 0,
        maxContentLength: 1024,
        maxBodyLength: 1024,
        responseType: 'json',
        responseEncoding: 'utf8',
        validateStatus: status => status < 500,
        throwHttpErrors: true,
        decompress: false,
        transitional: { clarifyTimeoutError: false },
        followRedirects: true,
        requestId: 'test',
        startTime: Date.now(),
        hops: 0,
        ...overrides,
    };
}

function concatChunks(chunks: readonly Uint8Array[], size: number): Uint8Array {
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}

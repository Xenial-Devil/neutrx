import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import zlib from 'node:zlib';
import type * as ParserModule from '../../../src/core/responseParser.js';

const parserEntry = '../../../../dist/core/responseParser.mjs';

void test('response parser enforces maxContentLength after decompression', async () => {
    const { decompressResponseData } = await import(parserEntry) as typeof ParserModule;
    const inflated = Buffer.alloc(2048, 'x');
    const compressed = zlib.gzipSync(inflated);

    await assert.rejects(
        decompressResponseData(compressed, { 'content-encoding': 'gzip' }, true, 1024),
        error => error instanceof Error
            && error.name === 'NeutrxResponseSizeError'
            && (error as { readonly code?: unknown }).code === 'RESPONSE_TOO_LARGE'
    );
});

void test('response parser preserves compressed bytes when decompression is disabled', async () => {
    const { decompressResponseData } = await import(parserEntry) as typeof ParserModule;
    const compressed = zlib.gzipSync(Buffer.from('safe payload'));

    assert.equal(await decompressResponseData(compressed, { 'content-encoding': 'gzip' }, false, 1), compressed);
});

void test('response parser decompresses gzip, deflate, and brotli payloads', async () => {
    const { decompressResponseData } = await import(parserEntry) as typeof ParserModule;
    const payload = Buffer.from('compressed payload');

    assert.deepEqual(await decompressResponseData(zlib.gzipSync(payload), { 'content-encoding': 'gzip' }, true), payload);
    assert.deepEqual(await decompressResponseData(zlib.deflateSync(payload), { 'content-encoding': 'deflate' }, true), payload);
    assert.deepEqual(await decompressResponseData(zlib.brotliCompressSync(payload), { 'content-encoding': 'br' }, true), payload);
});

void test('response parser returns original bytes for unknown or invalid encodings', async () => {
    const { decompressResponseData } = await import(parserEntry) as typeof ParserModule;
    const payload = Buffer.from('not compressed');

    assert.equal(await decompressResponseData(payload, { 'content-encoding': 'zstd' }, true), payload);
    assert.equal(await decompressResponseData(payload, { 'content-encoding': 'gzip' }, true), payload);
});

void test('response parser handles response types and strips prototype keys', async () => {
    const { normalizeNodeResponseData, parseResponseData } = await import(parserEntry) as typeof ParserModule;
    const json = parseResponseData(
        Buffer.from('{"ok":true,"__proto__":{"polluted":true},"constructor":{"bad":true}}'),
        'json',
        { 'content-type': 'application/json' },
        'utf8'
    ) as Record<string, unknown>;

    assert.deepEqual(json, { ok: true });
    assert.equal(Object.prototype.hasOwnProperty.call(json, '__proto__'), false);

    assert.equal(parseResponseData(Buffer.from('{bad'), 'json', { 'content-type': 'application/json' }, 'utf8'), '{bad');
    assert.equal(parseResponseData(Buffer.from('plain'), 'text', {}, 'utf8'), 'plain');
    assert.deepEqual(parseResponseData(new Uint8Array([1, 2, 3]), 'buffer', {}, 'utf8'), Buffer.from([1, 2, 3]));
    assert.equal((parseResponseData(Buffer.from('abc'), 'arrayBuffer', {}, 'utf8') as ArrayBuffer).byteLength, 3);

    const blob = new Blob(['hello'], { type: 'text/plain' });
    assert.equal(parseResponseData(blob, 'blob', {}, 'utf8'), blob);

    const form = new FormData();
    form.set('name', 'Ada');
    assert.equal(parseResponseData(form, 'formData', {}, 'utf8'), form);

    const stream = new ReadableStream<Uint8Array>();
    assert.equal(normalizeNodeResponseData(stream), stream);
    assert.deepEqual(normalizeNodeResponseData('abc'), Buffer.from('abc'));
    assert.deepEqual(normalizeNodeResponseData(new Uint8Array([4, 5])), Buffer.from([4, 5]));
    assert.deepEqual(normalizeNodeResponseData(null), Buffer.from(''));

    const readable = Readable.from(['x']);
    assert.equal(parseResponseData(readable as never, 'stream', {}, 'utf8'), readable);
    assert.equal(normalizeNodeResponseData(readable as never), readable);
});

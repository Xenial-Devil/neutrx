import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';
import type * as ErrorModule from '../../../src/core/NeutrxError.js';
import type * as ParserModule from '../../../src/core/responseParser.js';

const parserEntry = '../../../../dist/esm/core/responseParser.js';
const errorEntry = '../../../../dist/esm/core/NeutrxError.js';

void test('response parser enforces maxContentLength after decompression', async () => {
    const { decompressResponseData } = await import(parserEntry) as typeof ParserModule;
    const { NeutrxResponseSizeError } = await import(errorEntry) as typeof ErrorModule;
    const inflated = Buffer.alloc(2048, 'x');
    const compressed = zlib.gzipSync(inflated);

    await assert.rejects(
        decompressResponseData(compressed, { 'content-encoding': 'gzip' }, true, 1024),
        error => error instanceof NeutrxResponseSizeError
    );
});

void test('response parser preserves compressed bytes when decompression is disabled', async () => {
    const { decompressResponseData } = await import(parserEntry) as typeof ParserModule;
    const compressed = zlib.gzipSync(Buffer.from('safe payload'));

    assert.equal(await decompressResponseData(compressed, { 'content-encoding': 'gzip' }, false, 1), compressed);
});

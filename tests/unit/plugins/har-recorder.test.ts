import assert from 'node:assert/strict';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';

const builtEntry = '../../../../dist/index.mjs';

void test('createHarRecorder captures a HAR 1.2 entry per request', async () => {
    const { default: Neutrx, createHarRecorder } = await import(builtEntry) as typeof PackageEntry;
    const recorder = createHarRecorder();
    const api = Neutrx.create({ adapter: echoAdapter });
    api.use(recorder.plugin);

    await api.post('https://api.example.com/users?team=core', { name: 'ada' });

    const har = recorder.har();
    assert.equal(har.log.version, '1.2');
    assert.equal(har.log.creator.name, 'neutrx');
    assert.equal(har.log.entries.length, 1);

    const [entry] = har.log.entries;
    assert.ok(entry);
    assert.equal(entry.request.method, 'POST');
    assert.equal(entry.request.url, 'https://api.example.com/users?team=core');
    assert.deepEqual(entry.request.queryString, [{ name: 'team', value: 'core' }]);
    assert.equal(entry.request.postData?.text, JSON.stringify({ name: 'ada' }));
    assert.equal(entry.response.status, 200);
    assert.equal(entry.response.content.text, '{"ok":true}');
    assert.equal(typeof entry.startedDateTime, 'string');

    const parsed = JSON.parse(recorder.export()) as { readonly log: { readonly entries: readonly unknown[] } };
    assert.equal(parsed.log.entries.length, 1);
});

void test('createHarRecorder redacts sensitive headers by default', async () => {
    const { default: Neutrx, createHarRecorder } = await import(builtEntry) as typeof PackageEntry;
    const recorder = createHarRecorder();
    const api = Neutrx.create({ adapter: echoAdapter });
    api.use(recorder.plugin);

    await api.get('https://api.example.com/secure', { headers: { Authorization: 'Bearer super-secret' } });

    const [entry] = recorder.entries();
    assert.ok(entry);
    const auth = entry.request.headers.find(header => header.name.toLowerCase() === 'authorization');
    assert.equal(auth?.value, '[REDACTED]');
});

void test('createHarRecorder records failed requests with status 0', async () => {
    const { default: Neutrx, createHarRecorder } = await import(builtEntry) as typeof PackageEntry;
    const recorder = createHarRecorder();
    const api = Neutrx.create({ adapter: errorAdapter, resilience: { maxRetries: 0 } });
    api.use(recorder.plugin);

    await assert.rejects(api.get('https://api.example.com/boom', { throwHttpErrors: true }));

    const [entry] = recorder.entries();
    assert.ok(entry);
    assert.equal(entry.response.status, 0);
    assert.equal(typeof entry._error, 'string');
    assert.equal(entry.request.url, 'https://api.example.com/boom');
});

void test('createHarRecorder honors maxEntries and clear', async () => {
    const { default: Neutrx, createHarRecorder } = await import(builtEntry) as typeof PackageEntry;
    const recorder = createHarRecorder({ maxEntries: 2 });
    const api = Neutrx.create({ adapter: echoAdapter });
    api.use(recorder.plugin);

    await api.get('https://api.example.com/a');
    await api.get('https://api.example.com/b');
    await api.get('https://api.example.com/c');

    const entries = recorder.entries();
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.request.url, 'https://api.example.com/b');
    assert.equal(entries[1]?.request.url, 'https://api.example.com/c');

    recorder.clear();
    assert.equal(recorder.entries().length, 0);
});

function echoAdapter(config: PackageEntry.NeutrxRequestConfig): PackageEntry.RawHttpResponse {
    return {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data: Buffer.from('{"ok":true}'),
        config,
    };
}

function errorAdapter(config: PackageEntry.NeutrxRequestConfig): PackageEntry.RawHttpResponse {
    return {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'content-type': 'application/json' },
        data: Buffer.from('{"error":true}'),
        config,
    };
}

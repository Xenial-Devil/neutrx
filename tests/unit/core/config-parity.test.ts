import assert from 'node:assert/strict';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';
import type * as BodyModule from '../../../src/core/bodySerializer.js';
import type * as RedirectModule from '../../../src/core/redirect.js';
import type * as ErrorModule from '../../../src/core/NeutrxError.js';
import type { InternalRequestConfig, NeutrxResponse } from '../../../src/types.js';

const builtEntry = '../../../../dist/index.mjs';
const bodyEntry = '../../../../dist/core/bodySerializer.mjs';
const redirectEntry = '../../../../dist/core/redirect.mjs';
const errorEntry = '../../../../dist/core/NeutrxError.mjs';

// GAP CLASS 2 — config field parity holes. Each axios config field is wired into
// its enforcement point; these tests pin the observable behavior.

void test('formDataHeaderPolicy controls multipart Content-Type management', async () => {
    const { serializeBody } = await import(bodyEntry) as typeof BodyModule;
    const form = (): FormData => {
        const fd = new FormData();
        fd.set('name', 'Ada');
        return fd;
    };

    // auto (default): sets Content-Type with a generated boundary when absent.
    const autoHeaders: Record<string, string> = {};
    await serializeBody({ data: form(), headers: autoHeaders });
    assert.match(String(autoHeaders['Content-Type']), /^multipart\/form-data; boundary=/u);

    // preserve: sets it only when absent, never overwrites an existing Content-Type.
    const preserveSet: Record<string, string> = {};
    await serializeBody({ data: form(), headers: preserveSet, formDataHeaderPolicy: 'preserve' });
    assert.match(String(preserveSet['Content-Type']), /^multipart\/form-data; boundary=/u);

    const preserveKeep: Record<string, string> = { 'Content-Type': 'application/custom' };
    await serializeBody({ data: form(), headers: preserveKeep, formDataHeaderPolicy: 'preserve' });
    assert.equal(preserveKeep['Content-Type'], 'application/custom');

    // none: never touches headers — caller owns Content-Type entirely.
    const noneHeaders: Record<string, string> = {};
    await serializeBody({ data: form(), headers: noneHeaders, formDataHeaderPolicy: 'none' });
    assert.equal(noneHeaders['Content-Type'], undefined);
});

void test('env.FormData ctor is honored when building/detecting form bodies', async () => {
    const { serializeBody } = await import(bodyEntry) as typeof BodyModule;
    let constructed = 0;
    class TaggedFormData extends FormData {
        constructor() {
            super();
            constructed += 1;
        }
    }

    const headers: Record<string, string> = { 'Content-Type': 'multipart/form-data' };
    const body = await serializeBody({
        data: { name: 'Ada' },
        headers,
        env: { FormData: TaggedFormData },
    });
    assert.ok(Buffer.isBuffer(body));
    assert.equal(constructed, 1);
    assert.match(String(body), /name="name"/u);
});

void test('sensitiveHeaders extends the cross-origin redirect strip list', async () => {
    const { stripRedirectHeaders } = await import(redirectEntry) as typeof RedirectModule;
    const source = { authorization: 'a', 'x-api-token': 't', 'x-keep': 'k' };

    const cross = stripRedirectHeaders(
        source,
        'https://a.example/1',
        'https://b.example/2',
        false,
        ['x-api-token']
    );
    const crossJson = cross.toJSON();
    assert.equal(crossJson.authorization, undefined);
    assert.equal(crossJson['x-api-token'], undefined);
    assert.equal(crossJson['x-keep'], 'k');

    // Same-origin hop keeps everything — custom list only applies cross-origin.
    const same = stripRedirectHeaders(
        source,
        'https://a.example/1',
        'https://a.example/2',
        false,
        ['x-api-token']
    );
    const sameJson = same.toJSON();
    assert.equal(sameJson.authorization, 'a');
    assert.equal(sameJson['x-api-token'], 't');
});

void test('timeoutErrorMessage overrides default timeout phrasing', async () => {
    const { NeutrxResponseTimeoutError, NeutrxConnectTimeoutError } = await import(errorEntry) as typeof ErrorModule;

    assert.equal(new NeutrxResponseTimeoutError('https://x.example', 5).message, 'Response timeout after 5ms: https://x.example');
    assert.equal(new NeutrxResponseTimeoutError('https://x.example', 5, { timeoutErrorMessage: 'took too long' }).message, 'took too long');
    assert.equal(new NeutrxConnectTimeoutError('https://x.example', 5, { timeoutErrorMessage: 'no connect' }).message, 'no connect');
});

void test('redact masks extra keys in NeutrxHTTPError.toJSON', async () => {
    const { NeutrxHTTPError } = await import(errorEntry) as typeof ErrorModule;

    const response = {
        status: 500,
        statusText: 'Server Error',
        headers: { 'x-trace-secret': 'leak', 'x-keep': 'ok' },
        data: { sessionState: 'leak', keep: 'ok' },
        config: { url: 'https://api.example/v1?sessionState=leak', method: 'GET', redact: ['x-trace-secret', 'sessionState'] } as unknown as InternalRequestConfig,
        requestId: 'req-1',
        timing: { duration: 1 },
    } as unknown as NeutrxResponse;

    const json = new NeutrxHTTPError(response).toJSON();
    const rendered = json.response as { headers: Record<string, unknown>; data: Record<string, unknown> };
    assert.equal(rendered.headers['x-trace-secret'], '[REDACTED]');
    assert.equal(rendered.headers['x-keep'], 'ok');
    assert.equal(rendered.data.sessionState, '[REDACTED]');
    assert.equal(rendered.data.keep, 'ok');
    assert.match(String(json.url), /sessionState=\[REDACTED\]/u);
});

void test('allowedSocketPaths rejects socket paths outside the allowlist', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const client = Neutrx.create({ security: { profile: 'legacy' }, allowedSocketPaths: ['/tmp/allowed.sock'] });
    try {
        await assert.rejects(
            client.get('http://unix/health', { socketPath: '/tmp/evil.sock' }),
            /allowlist|SOCKET_PATH_NOT_ALLOWED/u
        );
    } finally {
        client.destroy();
    }
});

void test('insecureHTTPParser is gated to the legacy security profile', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    const adapter = (config: InternalRequestConfig): Promise<PackageEntry.RawHttpResponse> => Promise.resolve({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data: Buffer.from('{"ok":true}'),
        config,
    });

    const strict = Neutrx.create({ resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false } });
    try {
        await assert.rejects(
            strict.get('https://api.example/x', { insecureHTTPParser: true, adapter }),
            /legacy security profile|INSECURE_PARSER_BLOCKED/u
        );
    } finally {
        strict.destroy();
    }

    const legacy = Neutrx.create({
        security: { profile: 'legacy' },
        performance: { enableCaching: false },
        resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
    });
    try {
        const res = await legacy.get('https://api.example/x', { insecureHTTPParser: true, adapter });
        assert.deepEqual(res.data, { ok: true });
    } finally {
        legacy.destroy();
    }
});

void test('env.fetch is used by the fetch adapter when no explicit fetch is set', async () => {
    const { default: Neutrx } = await import(builtEntry) as typeof PackageEntry;
    let called = 0;
    const stubFetch = ((): Promise<Response> => {
        called += 1;
        return Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
    }) as unknown as typeof fetch;

    const client = Neutrx.create({
        adapter: 'fetch',
        performance: { enableCaching: false },
        resilience: { enableRetry: false, enableCircuitBreaker: false, enableBulkhead: false },
    });
    try {
        const res = await client.get('https://api.example/data', { env: { fetch: stubFetch } });
        assert.equal(called, 1);
        assert.deepEqual(res.data, { ok: true });
    } finally {
        client.destroy();
    }
});

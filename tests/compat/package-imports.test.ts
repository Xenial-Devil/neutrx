import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

void test('package self-reference imports expose ESM, CJS, and subpath APIs', async () => {
    const root = moduleRecord(await import('neutrx'));
    const nodeEntry = moduleRecord(await import('neutrx/node'));
    const headersEntry = moduleRecord(await import('neutrx/headers'));
    const instrumentationEntry = moduleRecord(await import('neutrx/instrumentation'));
    const adaptersEntry = moduleRecord(await import('neutrx/adapters'));
    const cjs = moduleRecord(require('neutrx') as unknown);

    assert.equal(typeof propertyRecord(root, 'default').create, 'function');
    assert.equal(typeof propertyRecord(nodeEntry, 'default').create, 'function');
    assert.equal(typeof propertyRecord(cjs, 'default').create, 'function');
    assert.equal(typeof headersEntry.NeutrxHeaders, 'function');
    assert.equal(typeof instrumentationEntry.OpenTelemetryInstrumentation, 'function');
    assert.equal(adaptersEntry.HttpAdapter, 'http');
    assert.equal(adaptersEntry.FetchAdapter, 'fetch');
    assert.equal(typeof adaptersEntry.fetchAdapter, 'function');
    assert.equal(typeof adaptersEntry.http2Adapter, 'function');
});

function moduleRecord(value: unknown): Record<string, unknown> {
    assert.ok(typeof value === 'object' || typeof value === 'function');
    assert.notEqual(value, null);
    return value as Record<string, unknown>;
}

function propertyRecord(source: Record<string, unknown>, key: string): Record<string, unknown> {
    return moduleRecord(source[key]);
}

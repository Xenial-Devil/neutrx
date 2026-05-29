import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
    assert.equal(typeof cjs, 'function');
    assert.equal(typeof propertyRecord(cjs, 'default').create, 'function');
    assert.equal(typeof headersEntry.NeutrxHeaders, 'function');
    assert.equal(typeof instrumentationEntry.OpenTelemetryInstrumentation, 'function');
    assert.equal(adaptersEntry.HttpAdapter, 'http');
    assert.equal(adaptersEntry.FetchAdapter, 'fetch');
    assert.equal(typeof adaptersEntry.nodeHttpAdapter, 'function');
    assert.equal(typeof adaptersEntry.fetchAdapter, 'function');
    assert.equal(typeof adaptersEntry.http2Adapter, 'function');
    assert.equal(typeof root.WebSocketPlugin, 'object');
    assert.equal(typeof root.LogPlugin, 'object');
    assert.equal(typeof root.OtelPlugin, 'object');
});

void test('package self-reference supports default ESM import syntax', () => {
    const result = spawnSync(process.execPath, [
        '--input-type=module',
        '--eval',
        "import neutrx from 'neutrx'; if (typeof neutrx !== 'function') throw new Error('missing default import'); if (typeof neutrx.create !== 'function') throw new Error('missing create');",
    ], {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: false,
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

void test('package self-reference supports CommonJS callable require', () => {
    const result = spawnSync(process.execPath, [
        '--eval',
        "const neutrx = require('neutrx'); if (typeof neutrx !== 'function') throw new Error('missing callable require'); if (typeof neutrx.create !== 'function') throw new Error('missing create');",
    ], {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: false,
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

function moduleRecord(value: unknown): Record<string, unknown> {
    assert.ok(typeof value === 'object' || typeof value === 'function');
    assert.notEqual(value, null);
    return value as Record<string, unknown>;
}

function propertyRecord(source: Record<string, unknown>, key: string): Record<string, unknown> {
    return moduleRecord(source[key]);
}

import assert from 'node:assert/strict';
import test from 'node:test';

void test('runtime is Node.js 22 or newer', () => {
    const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
    assert.ok(major >= 22, `Node.js >=22 required, got ${process.versions.node}`);
});

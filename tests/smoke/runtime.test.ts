import assert from 'node:assert/strict';
import test from 'node:test';

void test('runtime is Node.js 18 or newer', () => {
    const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
    assert.ok(major >= 18, `Node.js >=18 required, received ${process.versions.node}`);
});

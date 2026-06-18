import assert from 'node:assert/strict';
import neutrx from '../dist/index.mjs';

assert(typeof neutrx === 'function', 'neutrx default export must be callable');
assert(typeof neutrx.get === 'function', 'neutrx.get must be a function');
assert(typeof neutrx.post === 'function', 'neutrx.post must be a function');
assert(typeof neutrx.put === 'function', 'neutrx.put must be a function');
assert(typeof neutrx.delete === 'function', 'neutrx.delete must be a function');
assert(typeof neutrx.create === 'function', 'neutrx.create must be a function');

const instance = neutrx.create({ baseURL: 'https://example.com' });
assert(typeof instance.get === 'function', 'created instance must expose .get');
assert(typeof instance.request === 'function', 'created instance must expose .request');

console.log('Smoke test passed ✓');

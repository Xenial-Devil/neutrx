import assert from 'node:assert/strict';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';

const builtEntry = '../../../../dist/index.mjs';

void test('MemoryStateAdapter stores, lists, deletes, and clears values', async () => {
    const { MemoryStateAdapter } = await import(builtEntry) as typeof PackageEntry;
    const adapter = new MemoryStateAdapter<{ n: number }>({ sweepIntervalMs: 0 });

    assert.equal(adapter.get('a'), undefined);
    adapter.set('a', { n: 1 });
    adapter.set('b', { n: 2 });
    assert.deepEqual(adapter.get('a'), { n: 1 });
    assert.deepEqual([...adapter.keys()].sort(), ['a', 'b']);

    adapter.delete('a');
    assert.equal(adapter.get('a'), undefined);

    adapter.clear();
    assert.deepEqual([...adapter.keys()], []);
});

void test('MemoryStateAdapter expires entries past their ttl', async () => {
    const { MemoryStateAdapter } = await import(builtEntry) as typeof PackageEntry;
    const adapter = new MemoryStateAdapter<number>({ sweepIntervalMs: 0 });

    adapter.set('k', 5, 20);
    assert.equal(adapter.get('k'), 5);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(adapter.get('k'), undefined, 'entry should be gone after ttl');
});

void test('namespaceAdapter prefixes keys and isolates listings', async () => {
    const { MemoryStateAdapter, namespaceAdapter } = await import(builtEntry) as typeof PackageEntry;
    const shared = new MemoryStateAdapter<string>({ sweepIntervalMs: 0 });
    const tenantA = namespaceAdapter(shared, 'a');
    const tenantB = namespaceAdapter(shared, 'b');

    await tenantA.set('x', 'A');
    await tenantB.set('x', 'B');

    assert.equal(await tenantA.get('x'), 'A');
    assert.equal(await tenantB.get('x'), 'B');
    assert.deepEqual([...(await tenantA.keys?.() ?? [])], ['x']);
    // underlying backend keeps both physically distinct keys
    assert.deepEqual([...shared.keys()].sort(), ['a:x', 'b:x']);
});

void test('circuit + rate-limit bridges share one StateAdapter across components', async () => {
    const { MemoryStateAdapter, circuitStoreFromAdapter, rateLimitStoreFromAdapter } =
        await import(builtEntry) as typeof PackageEntry;
    const shared = new MemoryStateAdapter({ sweepIntervalMs: 0 });

    const circuitStore = circuitStoreFromAdapter(shared);
    const rateStore = rateLimitStoreFromAdapter(shared);

    await circuitStore.set('neutrx:default:circuit:origin:svc', { state: 'OPEN', failures: 3 });
    await rateStore.set('neutrx:default:ratelimit:origin:svc', { count: 7, windowId: 1 });

    assert.deepEqual(await circuitStore.get('neutrx:default:circuit:origin:svc'), { state: 'OPEN', failures: 3 });
    assert.deepEqual(await rateStore.get('neutrx:default:ratelimit:origin:svc'), { count: 7, windowId: 1 });
    assert.equal(await rateStore.get('missing'), undefined);
});

const circuitBreakerEntry = '../../../../dist/resilience/CircuitBreaker.mjs';

void test('CircuitBreaker persists state through a StateAdapter-backed store', async () => {
    const { MemoryStateAdapter, circuitStoreFromAdapter } = await import(builtEntry) as typeof PackageEntry;
    const { default: CircuitBreaker } = await import(circuitBreakerEntry) as {
        default: new (config: unknown) => {
            recordFailure(url: string): Promise<void>;
            canRequest(url: string): Promise<void>;
        };
    };
    const shared = new MemoryStateAdapter({ sweepIntervalMs: 0 });
    const storage = { store: circuitStoreFromAdapter(shared) };

    // Trip the breaker on one instance.
    const a = new CircuitBreaker({ failureThreshold: 2, circuitBreakerStorage: storage });
    await a.recordFailure('https://svc.example/x');
    await a.recordFailure('https://svc.example/x');

    // A fresh instance backed by the same adapter rehydrates the OPEN state and rejects.
    const b = new CircuitBreaker({ failureThreshold: 2, circuitTimeout: 60_000, circuitBreakerStorage: storage });
    await assert.rejects(() => b.canRequest('https://svc.example/x'), /circuit/i);
});

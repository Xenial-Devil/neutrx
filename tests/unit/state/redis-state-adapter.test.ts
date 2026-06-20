import assert from 'node:assert/strict';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';
import type { RedisLikeClient } from '../../../src/state/RedisStateAdapter.js';

const builtEntry = '../../../../dist/index.mjs';

/** In-memory stand-in for an ioredis / node-redis client. */
class FakeRedis implements RedisLikeClient {
    readonly store = new Map<string, string>();
    readonly pexpireCalls: Array<{ key: string; ttlMs: number }> = [];

    get(key: string): Promise<string | null> {
        return Promise.resolve(this.store.has(key) ? this.store.get(key)! : null);
    }

    set(key: string, value: string): Promise<unknown> {
        this.store.set(key, value);
        return Promise.resolve('OK');
    }

    pexpire(key: string, ttlMs: number): Promise<unknown> {
        this.pexpireCalls.push({ key, ttlMs });
        return Promise.resolve(1);
    }

    del(key: string | string[]): Promise<unknown> {
        const keys = Array.isArray(key) ? key : [key];
        let removed = 0;
        for (const k of keys) if (this.store.delete(k)) removed++;
        return Promise.resolve(removed);
    }

    keys(pattern: string): Promise<string[]> {
        const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
        return Promise.resolve([...this.store.keys()].filter(k => k.startsWith(prefix)));
    }
}

void test('RedisStateAdapter round-trips JSON values under its key prefix', async () => {
    const { RedisStateAdapter } = await import(builtEntry) as typeof PackageEntry;
    const client = new FakeRedis();
    const adapter = new RedisStateAdapter<{ n: number }>({ client, keyPrefix: 'nx:' });

    await adapter.set('a', { n: 1 });
    assert.equal(client.store.get('nx:a'), '{"n":1}', 'stored namespaced + serialized');
    assert.deepEqual(await adapter.get('a'), { n: 1 });
    assert.equal(await adapter.get('missing'), undefined);
});

void test('RedisStateAdapter maps ttlMs to a ceil PEXPIRE', async () => {
    const { RedisStateAdapter } = await import(builtEntry) as typeof PackageEntry;
    const client = new FakeRedis();
    const adapter = new RedisStateAdapter<number>({ client });

    await adapter.set('k', 5, 250.4);
    assert.deepEqual(client.pexpireCalls, [{ key: 'neutrx:k', ttlMs: 251 }]);

    await adapter.set('k2', 6);
    assert.equal(client.pexpireCalls.length, 1, 'no ttl => no pexpire');
});

void test('RedisStateAdapter keys() strips the prefix and clear() scopes to it', async () => {
    const { RedisStateAdapter } = await import(builtEntry) as typeof PackageEntry;
    const client = new FakeRedis();
    client.store.set('other:keep', '"untouched"'); // foreign key outside our namespace
    const adapter = new RedisStateAdapter<string>({ client, keyPrefix: 'nx:' });

    await adapter.set('a', 'A');
    await adapter.set('b', 'B');
    assert.deepEqual([...(await adapter.keys())].sort(), ['a', 'b']);

    await adapter.delete('a');
    assert.equal(await adapter.get('a'), undefined);

    await adapter.clear();
    assert.deepEqual([...(await adapter.keys())], []);
    assert.equal(client.store.get('other:keep'), '"untouched"', 'clear must not touch foreign keys');
});

void test('RedisStateAdapter bridges into a shared circuit + rate-limit store', async () => {
    const { RedisStateAdapter, circuitStoreFromAdapter, rateLimitStoreFromAdapter } =
        await import(builtEntry) as typeof PackageEntry;
    const client = new FakeRedis();
    const adapter = new RedisStateAdapter({ client, keyPrefix: 'shared:' });

    const circuit = circuitStoreFromAdapter(adapter);
    const limiter = rateLimitStoreFromAdapter(adapter);

    await circuit.set('svc', { state: 'OPEN', failures: 5, openedAt: 1000 });
    await limiter.set('ip', { count: 3, windowId: 7 });

    assert.deepEqual(await circuit.get('svc'), { state: 'OPEN', failures: 5, openedAt: 1000 });
    assert.deepEqual(await limiter.get('ip'), { count: 3, windowId: 7 });
    // Both live in one backend under the shared prefix.
    assert.deepEqual([...client.store.keys()].sort(), ['shared:ip', 'shared:svc']);
});

void test('RedisStateAdapter rejects a client missing get', async () => {
    const { RedisStateAdapter } = await import(builtEntry) as typeof PackageEntry;
    assert.throws(
        () => new RedisStateAdapter({ client: {} as unknown as RedisLikeClient }),
        /Redis-compatible client/
    );
});

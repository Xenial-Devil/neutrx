import assert from 'node:assert/strict';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';

const builtEntry = '../../../../dist/index.mjs';

async function loadDataLoader(): Promise<typeof PackageEntry.DataLoader> {
    const { DataLoader } = await import(builtEntry) as typeof PackageEntry;
    return DataLoader;
}

void test('DataLoader coalesces same-frame loads into one batch call', async () => {
    const DataLoader = await loadDataLoader();
    const calls: ReadonlyArray<number>[] = [];
    const loader = new DataLoader<number, number>(keys => {
        calls.push(keys);
        return Promise.resolve(keys.map(k => k * 2));
    });

    const results = await Promise.all([loader.load(1), loader.load(2), loader.load(3)]);
    assert.deepEqual(results, [2, 4, 6]);
    assert.equal(calls.length, 1, 'three same-frame loads => one batch');
    assert.deepEqual(calls[0], [1, 2, 3]);
});

void test('DataLoader memoizes per key and dedupes within a batch', async () => {
    const DataLoader = await loadDataLoader();
    let batches = 0;
    const loader = new DataLoader<string, string>(keys => {
        batches++;
        return Promise.resolve(keys.map(k => k.toUpperCase()));
    });

    const [a1, a2] = await Promise.all([loader.load('a'), loader.load('a')]);
    assert.equal(a1, 'A');
    assert.equal(a2, 'A');
    // Second load resolves from cache, no new batch.
    assert.equal(await loader.load('a'), 'A');
    assert.equal(batches, 1, 'cached key never re-dispatches');
});

void test('DataLoader rejects only the slot returned as an Error', async () => {
    const DataLoader = await loadDataLoader();
    const loader = new DataLoader<number, string>(keys =>
        Promise.resolve(keys.map(k => (k === 2 ? new Error('boom') : `v${k}`)))
    );

    const results = await loader.loadMany([1, 2, 3]);
    assert.equal(results[0], 'v1');
    const failed = results[1];
    if (failed instanceof Error) assert.equal(failed.message, 'boom');
    else assert.fail('slot 1 should be an Error');
    assert.equal(results[2], 'v3');
});

void test('DataLoader does not cache a rejected load', async () => {
    const DataLoader = await loadDataLoader();
    let attempt = 0;
    const loader = new DataLoader<string, string>(keys => {
        attempt++;
        return Promise.resolve(keys.map(() => (attempt === 1 ? new Error('transient') : 'ok')));
    });

    await assert.rejects(loader.load('k'), /transient/);
    // Same key retried after failure dispatches again and succeeds.
    assert.equal(await loader.load('k'), 'ok');
    assert.equal(attempt, 2);
});

void test('DataLoader splits oversized batches by maxBatchSize', async () => {
    const DataLoader = await loadDataLoader();
    const sizes: number[] = [];
    const loader = new DataLoader<number, number>(keys => {
        sizes.push(keys.length);
        return Promise.resolve(keys.map(k => k));
    }, { maxBatchSize: 2 });

    await Promise.all([1, 2, 3, 4, 5].map(k => loader.load(k)));
    assert.deepEqual(sizes, [2, 2, 1]);
});

void test('DataLoader prime seeds the cache and clear evicts it', async () => {
    const DataLoader = await loadDataLoader();
    let batches = 0;
    const loader = new DataLoader<string, number>(keys => {
        batches++;
        return Promise.resolve(keys.map(() => 99));
    });

    loader.prime('x', 42);
    assert.equal(await loader.load('x'), 42);
    assert.equal(batches, 0, 'primed key skips the batch function');

    loader.clear('x');
    assert.equal(await loader.load('x'), 99, 'cleared key re-dispatches');
    assert.equal(batches, 1);
});

void test('DataLoader with cache:false re-dispatches every load', async () => {
    const DataLoader = await loadDataLoader();
    let batches = 0;
    const loader = new DataLoader<string, string>(keys => {
        batches++;
        return Promise.resolve(keys.map(k => k));
    }, { cache: false });

    await loader.load('a');
    await loader.load('a');
    assert.equal(batches, 2, 'no memoization without cache');
});

void test('DataLoader rejects all slots when the batch function returns a bad length', async () => {
    const DataLoader = await loadDataLoader();
    const loader = new DataLoader<number, number>(() => Promise.resolve([1]));
    await assert.rejects(Promise.all([loader.load(1), loader.load(2)]), /same length/);
});

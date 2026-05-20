import assert from 'node:assert/strict';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';

const builtEntry = '../../../../dist/esm/index.js';

void test('CancelToken source is idempotent and exposed on root client', async () => {
    const { Cancel, CancelToken, default: neutrx, isCancel } = await import(builtEntry) as typeof PackageEntry;
    const source = CancelToken.source();

    source.cancel('legacy cancel');
    source.cancel('ignored cancel');

    assert.ok(source.token.reason instanceof Cancel);
    assert.ok(isCancel(source.token.reason));
    assert.equal(source.token.reason?.message, 'legacy cancel');
    assert.throws(() => source.token.throwIfRequested(), Cancel);

    const signal = source.token.toAbortSignal();
    assert.equal(signal.aborted, true);
    assert.equal(signal.reason, source.token.reason);

    const rootSource = neutrx.CancelToken.source();
    rootSource.cancel('root cancel');
    assert.ok(neutrx.isCancel(rootSource.token.reason));
});

void test('pre-canceled CancelToken rejects before adapter dispatch', async () => {
    const { CancelToken, default: neutrx, isCancel } = await import(builtEntry) as typeof PackageEntry;
    const source = CancelToken.source();
    let dispatched = false;
    const api = neutrx.create({
        adapter: () => {
            dispatched = true;
            return {
                status: 200,
                statusText: 'OK',
                headers: {},
                data: 'ok',
                config: null as never,
            };
        },
    });

    source.cancel('before dispatch');

    await assert.rejects(
        api.get('https://api.example.com/users', { cancelToken: source.token }),
        error => isCancel(error) && error.message === 'before dispatch'
    );
    assert.equal(dispatched, false);
});

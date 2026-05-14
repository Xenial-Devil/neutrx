import assert from 'node:assert/strict';
import test from 'node:test';
import type * as RetryModule from '../../../src/resilience/RetryEngine.js';
import type CircuitBreaker from '../../../src/resilience/CircuitBreaker.js';
import type Bulkhead from '../../../src/resilience/Bulkhead.js';

const retryEntry = '../../../../dist/esm/resilience/RetryEngine.js';
const circuitEntry = '../../../../dist/esm/resilience/CircuitBreaker.js';
const bulkheadEntry = '../../../../dist/esm/resilience/Bulkhead.js';

void test('RetryEngine retries retryable errors and reports attempts', async () => {
    const { RetryEngine } = await import(retryEntry) as typeof RetryModule;
    const engine = new RetryEngine({ maxRetries: 2, retryDelay: 0, retryJitter: false, retryableCodes: ['ETEST'] });
    let calls = 0;

    const result = await engine.execute(async () => {
        await Promise.resolve();
        calls += 1;
        if (calls < 2) throw Object.assign(new Error('retry me'), { code: 'ETEST' });
        return 'ok';
    });

    assert.equal(result.result, 'ok');
    assert.equal(result.attempts.length, 2);
});

void test('CircuitBreaker opens after threshold and recovers after timeout', async () => {
    const { default: Circuit } = await import(circuitEntry) as { readonly default: typeof CircuitBreaker };
    const circuit = new Circuit({ failureThreshold: 1, successThreshold: 1, circuitTimeout: 50 });
    const url = 'https://api.example.com/users';

    circuit.canRequest(url);
    circuit.recordFailure(url);
    assert.throws(() => circuit.canRequest(url), /Circuit open/u);

    await new Promise(resolve => setTimeout(resolve, 60));
    circuit.canRequest(url);
    circuit.recordSuccess(url);
    assert.equal(circuit.getStatus(url).state, 'CLOSED');
});

void test('Bulkhead queues work over concurrency limit', async () => {
    const { default: BulkheadClass } = await import(bulkheadEntry) as { readonly default: typeof Bulkhead };
    const bulkhead = new BulkheadClass({ maxConcurrent: 1, maxQueue: 1, bulkheadQueueTimeout: 1000 });
    let release!: () => void;
    const first = bulkhead.execute('api.example.com', () => new Promise<string>(resolve => {
        release = () => resolve('first');
    }));
    const second = bulkhead.execute('api.example.com', async () => {
        await Promise.resolve();
        return 'second';
    });

    assert.equal(bulkhead.getStats().domains['api.example.com']?.queued, 1);
    release();
    assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
});

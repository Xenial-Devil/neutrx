import assert from 'node:assert/strict';
import test from 'node:test';
import type * as RetryModule from '../../../src/resilience/RetryEngine.js';
import type CircuitBreaker from '../../../src/resilience/CircuitBreaker.js';
import type Bulkhead from '../../../src/resilience/Bulkhead.js';
import type { CircuitStateStore, CircuitStatus, RetryBudgetStore } from '../../../src/types.js';

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

void test('RetryEngine retries idempotent methods by default', async () => {
    const { RetryEngine } = await import(retryEntry) as typeof RetryModule;
    const engine = new RetryEngine({ maxRetries: 2, retryDelay: 0, retryJitter: false, retryableCodes: ['ETEST'] });
    let calls = 0;

    await assert.rejects(
        engine.execute(async () => {
            await Promise.resolve();
            calls += 1;
            throw Object.assign(new Error('unsafe retry'), { code: 'ETEST' });
        }, { method: 'POST', url: 'https://api.example.com/users' })
    );

    assert.equal(calls, 1);
});

void test('RetryEngine respects Retry-After before retrying', async () => {
    const { RetryEngine } = await import(retryEntry) as typeof RetryModule;
    let observedDelay = 0;
    const engine = new RetryEngine({
        maxRetries: 1,
        retryDelay: 0,
        maxRetryDelay: 10,
        retryJitter: false,
        retryableCodes: ['ETEST'],
        onRetry: event => {
            observedDelay = event.delay;
        },
    });
    let calls = 0;

    const result = await engine.execute(async () => {
        await Promise.resolve();
        calls += 1;
        if (calls === 1) {
            throw Object.assign(new Error('retry later'), {
                code: 'ETEST',
                retryAfter: '1',
            });
        }
        return 'ok';
    }, { method: 'GET', url: 'https://api.example.com/users' });

    assert.equal(result.result, 'ok');
    assert.equal(calls, 2);
    assert.equal(observedDelay, 10);
});

void test('RetryEngine stops during backoff when AbortSignal aborts', async () => {
    const { RetryEngine } = await import(retryEntry) as typeof RetryModule;
    const controller = new AbortController();
    const engine = new RetryEngine({
        maxRetries: 2,
        retryDelay: 1000,
        retryJitter: false,
        retryableCodes: ['ETEST'],
        onRetry: () => controller.abort(),
    });
    let calls = 0;

    await assert.rejects(
        engine.execute(async () => {
            await Promise.resolve();
            calls += 1;
            throw Object.assign(new Error('retry me'), { code: 'ETEST' });
        }, { method: 'GET', signal: controller.signal, url: 'https://api.example.com/users' }),
        /aborted/u
    );

    assert.equal(calls, 1);
});

void test('RetryEngine stops when retry deadline expires', async () => {
    const { RetryEngine } = await import(retryEntry) as typeof RetryModule;
    const engine = new RetryEngine({ maxRetries: 2, retryDelay: 50, retryJitter: false, retryableCodes: ['ETEST'] });
    let calls = 0;

    await assert.rejects(
        engine.execute(async () => {
            await Promise.resolve();
            calls += 1;
            throw Object.assign(new Error('retry me'), { code: 'ETEST' });
        }, { method: 'GET', deadlineAt: Date.now() + 1, url: 'https://api.example.com/users' }),
        /deadline/u
    );

    assert.equal(calls, 1);
});

void test('RetryEngine enforces retry budget', async () => {
    const { RetryEngine } = await import(retryEntry) as typeof RetryModule;
    const engine = new RetryEngine({
        maxRetries: 3,
        retryDelay: 0,
        retryJitter: false,
        retryableCodes: ['ETEST'],
        retryBudget: { maxRetries: 1, windowMs: 60_000 },
    });
    let calls = 0;

    await assert.rejects(
        engine.execute(async () => {
            await Promise.resolve();
            calls += 1;
            throw Object.assign(new Error('budgeted retry'), { code: 'ETEST' });
        }, { method: 'GET', url: 'https://api.example.com/users' })
    );

    assert.equal(calls, 2);
});

void test('RetryEngine can consume a shared retry budget store by origin', async () => {
    const { RetryEngine } = await import(retryEntry) as typeof RetryModule;
    const store = new MemoryRetryBudgetStore();
    const engine = new RetryEngine({
        maxRetries: 3,
        retryDelay: 0,
        retryJitter: false,
        retryableCodes: ['ETEST'],
        retryBudget: {
            maxRetries: 1,
            windowMs: 60_000,
            scope: 'origin',
            namespace: 'fleet',
            store,
        },
    });
    let calls = 0;

    await assert.rejects(
        engine.execute(async () => {
            await Promise.resolve();
            calls += 1;
            throw Object.assign(new Error('shared budget'), { code: 'ETEST' });
        }, { method: 'GET', url: 'https://api.example.com/users' })
    );

    assert.equal(calls, 2);
    assert.equal(store.touchedKeys[0], 'neutrx:fleet:retry-budget:origin:https:__api.example.com');
});

void test('CircuitBreaker opens after threshold and recovers after timeout', async () => {
    const { default: Circuit } = await import(circuitEntry) as { readonly default: typeof CircuitBreaker };
    const circuit = new Circuit({ failureThreshold: 1, successThreshold: 1, circuitTimeout: 50 });
    const url = 'https://api.example.com/users';

    await circuit.canRequest(url);
    await circuit.recordFailure(url);
    await assert.rejects(() => circuit.canRequest(url), /Circuit open/u);

    await new Promise(resolve => setTimeout(resolve, 60));
    await circuit.canRequest(url);
    await circuit.recordSuccess(url);
    assert.equal(circuit.getStatus(url).state, 'CLOSED');
});

void test('CircuitBreaker persists state through a shared circuit store', async () => {
    const { default: Circuit } = await import(circuitEntry) as { readonly default: typeof CircuitBreaker };
    const store = new MemoryCircuitStateStore();
    const url = 'https://api.example.com/users';
    const first = new Circuit({
        failureThreshold: 1,
        successThreshold: 1,
        circuitTimeout: 50,
        circuitBreakerStorage: { store, namespace: 'fleet' },
    });

    await first.canRequest(url);
    await first.recordFailure(url);

    const second = new Circuit({
        failureThreshold: 1,
        successThreshold: 1,
        circuitTimeout: 50,
        circuitBreakerStorage: { store, namespace: 'fleet' },
    });

    await assert.rejects(() => second.canRequest(url), /Circuit open/u);
    assert.equal(store.touchedKeys[0], 'neutrx:fleet:circuit:origin:https:__api.example.com');

    await new Promise(resolve => setTimeout(resolve, 60));
    await second.canRequest(url);
    await second.recordSuccess(url);
    assert.equal(second.getStatus(url).state, 'CLOSED');
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

void test('Bulkhead adaptive concurrency raises and lowers per-origin limits', async () => {
    const { default: BulkheadClass } = await import(bulkheadEntry) as { readonly default: typeof Bulkhead };
    const bulkhead = new BulkheadClass({
        maxConcurrent: 2,
        adaptiveConcurrency: {
            enabled: true,
            initialLimit: 2,
            minLimit: 1,
            maxLimit: 4,
            targetLatency: 1000,
            increaseStep: 1,
            decreaseRatio: 0.7,
        },
    });

    await bulkhead.execute('api.example.com', async () => {
        await Promise.resolve();
        return 'ok';
    });
    assert.equal(bulkhead.getStats().domains['api.example.com']?.limit, 3);

    await assert.rejects(
        bulkhead.execute('api.example.com', async () => {
            await Promise.resolve();
            throw new Error('downstream failed');
        })
    );

    assert.equal(bulkhead.getStats().domains['api.example.com']?.limit, 2);
    assert.equal(bulkhead.getStats().domains['api.example.com']?.adaptive, true);
});

class MemoryRetryBudgetStore implements RetryBudgetStore {
    readonly touchedKeys: string[] = [];
    readonly spent = new Map<string, number[]>();

    consume(key: string, limit: number, windowMs: number, now: number): boolean {
        this.touchedKeys.push(key);
        const fresh = (this.spent.get(key) ?? []).filter(timestamp => now - timestamp < windowMs);
        if (fresh.length >= limit) {
            this.spent.set(key, fresh);
            return false;
        }
        fresh.push(now);
        this.spent.set(key, fresh);
        return true;
    }
}

class MemoryCircuitStateStore implements CircuitStateStore {
    readonly touchedKeys: string[] = [];
    readonly records = new Map<string, CircuitStatus>();

    get(key: string): CircuitStatus | undefined {
        this.touchedKeys.push(key);
        return this.records.get(key);
    }

    set(key: string, value: CircuitStatus): void {
        this.touchedKeys.push(key);
        this.records.set(key, value);
    }
}

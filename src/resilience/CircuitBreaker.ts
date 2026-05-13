import { NeutrxCircuitBreakerError } from '../core/NeutrxError.js';
import type { CircuitStatus, ResilienceConfig } from '../types.js';

const STATE = Object.freeze({
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    HALF_OPEN: 'HALF_OPEN',
});

type CircuitState = typeof STATE[keyof typeof STATE];

interface CircuitRecord {
    state: CircuitState;
    failures: number;
    successCount: number;
    active: number;
    openedAt: number | null;
    lastFailure: number | null;
}

interface NormalizedCircuitConfig {
    readonly enabled: boolean;
    readonly failureThreshold: number;
    readonly successThreshold: number;
    readonly timeout: number;
}

export default class CircuitBreaker {
    #circuits = new Map<string, CircuitRecord>();
    #config: NormalizedCircuitConfig;

    constructor(config: ResilienceConfig = {}) {
        this.#config = {
            enabled: config.enableCircuitBreaker ?? true,
            failureThreshold: config.failureThreshold ?? 5,
            successThreshold: config.successThreshold ?? 2,
            timeout: config.circuitTimeout ?? 60_000,
        };
    }

    canRequest(url: string): void {
        if (!this.#config.enabled) return;
        const circuit = this.#get(url);

        if (circuit.state === STATE.OPEN) {
            const elapsed = Date.now() - (circuit.openedAt ?? 0);
            const remaining = this.#config.timeout - elapsed;
            if (remaining > 0) throw new NeutrxCircuitBreakerError(url, remaining);

            circuit.state = STATE.HALF_OPEN;
            circuit.successCount = 0;
        }

        circuit.active += 1;
    }

    recordSuccess(url: string): void {
        if (!this.#config.enabled) return;
        const circuit = this.#get(url);
        circuit.active = Math.max(0, circuit.active - 1);

        if (circuit.state === STATE.HALF_OPEN) {
            circuit.successCount += 1;
            if (circuit.successCount >= this.#config.successThreshold) {
                circuit.state = STATE.CLOSED;
                circuit.failures = 0;
                circuit.successCount = 0;
            }
            return;
        }

        if (circuit.state === STATE.CLOSED) {
            circuit.failures = 0;
        }
    }

    recordFailure(url: string): void {
        if (!this.#config.enabled) return;
        const circuit = this.#get(url);
        circuit.active = Math.max(0, circuit.active - 1);
        circuit.failures += 1;
        circuit.lastFailure = Date.now();

        if (circuit.state === STATE.HALF_OPEN || circuit.failures >= this.#config.failureThreshold) {
            circuit.state = STATE.OPEN;
            circuit.openedAt = Date.now();
        }
    }

    getStatus(url?: string): CircuitStatus | Record<string, CircuitStatus> {
        if (url) {
            return this.#circuits.get(this.#domain(url)) ?? { state: STATE.CLOSED };
        }
        return Object.fromEntries(this.#circuits);
    }

    #get(url: string): CircuitRecord {
        const key = this.#domain(url);
        const existing = this.#circuits.get(key);
        if (existing) return existing;

        const created: CircuitRecord = {
            state: STATE.CLOSED,
            failures: 0,
            successCount: 0,
            active: 0,
            openedAt: null,
            lastFailure: null,
        };
        this.#circuits.set(key, created);
        return created;
    }

    #domain(url: string): string {
        try {
            return new URL(url).hostname;
        } catch {
            return url;
        }
    }
}

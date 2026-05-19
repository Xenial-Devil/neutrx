import { NeutrxCircuitBreakerError } from '../core/NeutrxError.js';
import type { CircuitBreakerStorageConfig, CircuitStatus, ResilienceConfig } from '../types.js';

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
    readonly storage?: CircuitBreakerStorageConfig;
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
            ...(config.circuitBreakerStorage ? { storage: config.circuitBreakerStorage } : {}),
        };
    }

    async canRequest(url: string): Promise<void> {
        if (!this.#config.enabled) return;
        const key = this.#key(url);
        const circuit = await this.#get(key);

        if (circuit.state === STATE.OPEN) {
            const elapsed = Date.now() - (circuit.openedAt ?? 0);
            const remaining = this.#config.timeout - elapsed;
            if (remaining > 0) throw new NeutrxCircuitBreakerError(url, remaining);

            circuit.state = STATE.HALF_OPEN;
            circuit.successCount = 0;
        }

        circuit.active += 1;
        await this.#set(key, circuit);
    }

    async recordSuccess(url: string): Promise<void> {
        if (!this.#config.enabled) return;
        const key = this.#key(url);
        const circuit = await this.#get(key);
        circuit.active = Math.max(0, circuit.active - 1);

        if (circuit.state === STATE.HALF_OPEN) {
            circuit.successCount += 1;
            if (circuit.successCount >= this.#config.successThreshold) {
                circuit.state = STATE.CLOSED;
                circuit.failures = 0;
                circuit.successCount = 0;
            }
            await this.#set(key, circuit);
            return;
        }

        if (circuit.state === STATE.CLOSED) {
            circuit.failures = 0;
        }
        await this.#set(key, circuit);
    }

    async recordFailure(url: string): Promise<void> {
        if (!this.#config.enabled) return;
        const key = this.#key(url);
        const circuit = await this.#get(key);
        circuit.active = Math.max(0, circuit.active - 1);
        circuit.failures += 1;
        circuit.lastFailure = Date.now();

        if (circuit.state === STATE.HALF_OPEN || circuit.failures >= this.#config.failureThreshold) {
            circuit.state = STATE.OPEN;
            circuit.openedAt = Date.now();
        }
        await this.#set(key, circuit);
    }

    getStatus(url?: string): CircuitStatus | Record<string, CircuitStatus> {
        if (url) {
            return this.#circuits.get(this.#key(url)) ?? { state: STATE.CLOSED };
        }
        return Object.fromEntries(this.#circuits);
    }

    async #get(key: string): Promise<CircuitRecord> {
        const existing = this.#circuits.get(key);
        if (existing) return existing;

        const stored = await this.#config.storage?.store.get(key);
        if (stored) {
            const hydrated = recordFromStatus(stored);
            this.#circuits.set(key, hydrated);
            return hydrated;
        }

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

    async #set(key: string, circuit: CircuitRecord): Promise<void> {
        this.#circuits.set(key, circuit);
        await this.#config.storage?.store.set(key, { ...circuit });
    }

    #key(url: string): string {
        const namespace = safeKeyPart(this.#config.storage?.namespace ?? 'default');
        const scope = this.#config.storage?.scope ?? 'origin';
        const target = scope === 'global' ? 'global' : this.#domain(url);
        return `neutrx:${namespace}:circuit:${scope}:${target}`;
    }

    #domain(url: string): string {
        try {
            return safeKeyPart(new URL(url).origin);
        } catch {
            return safeKeyPart(url);
        }
    }
}

function recordFromStatus(status: CircuitStatus): CircuitRecord {
    return {
        state: status.state,
        failures: status.failures ?? 0,
        successCount: status.successCount ?? 0,
        active: status.active ?? 0,
        openedAt: status.openedAt ?? null,
        lastFailure: status.lastFailure ?? null,
    };
}

function safeKeyPart(value: string): string {
    return value.replace(/[^a-zA-Z0-9:._-]/g, '_');
}

import type { ClientConfig } from '../types.js';

/** Config keys whose object values are merged one level deep rather than replaced. */
const DEEP_MERGE_KEYS = [
    'security',
    'resilience',
    'performance',
    'transitional',
    'tls',
    'http2Options',
    'egressPolicy',
    'instrumentation',
    'env',
] as const satisfies readonly (keyof ClientConfig)[];

/**
 * Axios-compatible `mergeConfig(config1, config2)`. Shallow-merges two
 * {@link ClientConfig} objects with `config2` winning, while deep-merging the
 * well-known nested option groups (`security`, `resilience`, `performance`,
 * `transitional`, `tls`, `http2Options`, `egressPolicy`, `instrumentation`, `env`).
 *
 * Unlike the internal config builder this does NOT inject defaults — it only
 * combines the two inputs, matching axios's helper used by codemods and tooling.
 */
export function mergeConfig(config1: ClientConfig = {}, config2: ClientConfig = {}): ClientConfig {
    const merged: Record<string, unknown> = { ...config1, ...config2 };

    for (const key of DEEP_MERGE_KEYS) {
        const a = config1[key];
        const b = config2[key];
        if (isPlainObject(a) && isPlainObject(b)) {
            merged[key] = { ...a, ...b };
        }
    }

    return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

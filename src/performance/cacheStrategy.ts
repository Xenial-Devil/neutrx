import type { CacheStrategy, CacheStrategyInput } from '../types.js';

export function normalizeCacheStrategy(strategy: CacheStrategyInput | undefined): CacheStrategy {
    if (strategy === undefined || strategy === 'ttl') return 'max-age';
    if (strategy === 'stale-while-revalidate') return 'swr';
    return strategy;
}

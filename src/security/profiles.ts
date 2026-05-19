import type { SecurityProfile, SecurityProfileInput } from '../types.js';

export function normalizeSecurityProfile(profile: SecurityProfileInput | undefined): SecurityProfile {
    switch (profile) {
        case 'strict':
            return 'strict';
        case 'legacy':
            return 'legacy';
        case 'standard':
        case 'balanced':
        case undefined:
            return 'standard';
        default:
            return assertNever(profile);
    }
}

function assertNever(value: never): never {
    throw new Error(`Unknown security profile: ${String(value)}`);
}

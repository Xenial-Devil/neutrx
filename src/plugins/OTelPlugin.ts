import type { InstrumentationConfig } from '../types.js';
import { VERSION } from '../version.js';
import type { NeutrxPlugin } from './PluginManager.js';

export type OtelPluginOptions = InstrumentationConfig;

export function createOtelPlugin(config: OtelPluginOptions = {}): NeutrxPlugin {
    return {
        name: 'otel',
        version: VERSION,

        install(client) {
            client.enableOpenTelemetry(config);
        },
    };
}

export const OtelPlugin: NeutrxPlugin = createOtelPlugin();

import neutrx, { isNeutrxError } from 'neutrx';

export const docker = neutrx.create({
    baseURL: 'http://docker',
    socketPath: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock',
    proxy: false,
    timeout: 5_000,
    maxContentLength: 2 * 1024 * 1024,
});

export const enterpriseApi = neutrx.create({
    baseURL: 'https://inventory.internal.example',
    allowAbsoluteUrls: false,
    proxy: process.env.LOCAL_PROXY_PORT
        ? { host: '127.0.0.1', port: Number.parseInt(process.env.LOCAL_PROXY_PORT, 10) }
        : false,
    timeout: 15_000,
    connectTimeout: 2_000,
    responseEncoding: 'utf8',
    decompress: true,
    maxRate: [256 * 1024, 512 * 1024],
    transitional: { clarifyTimeoutError: true },
    security: {
        profile: 'standard',
        allowedHosts: ['inventory.internal.example'],
    },
    beforeRedirect(context) {
        context.headers['X-Redirect-Checked'] = 'neutrx';
    },
});

export async function dockerVersion(): Promise<unknown> {
    const response = await docker.get('/v1/version');
    return response.data;
}

export async function downloadInventoryExport(): Promise<Buffer> {
    const response = await enterpriseApi.download('/exports/inventory.csv', {
        maxRate: [0, 512 * 1024],
        onDownloadProgress(event) {
            if (event.progress === 1) {
                enterpriseApi.emit('export:downloaded', { bytes: event.loaded });
            }
        },
    });

    return response.data;
}

export async function safeInfrastructureCall(): Promise<unknown> {
    try {
        const response = await enterpriseApi.get('/health');
        return response.data;
    } catch (error) {
        if (isNeutrxError(error)) {
            enterpriseApi.logger?.warn?.({ code: error.code, phase: error.toJSON().phase as string | undefined });
        }
        throw error;
    }
}


import assert from 'node:assert/strict';
import test from 'node:test';
import type * as PackageEntry from '../../../src/index.js';
import type { InternalRequestConfig, NeutrxResponse } from '../../../src/types.js';

const builtEntry = '../../../../dist/index.mjs';
type OTelGlobal = typeof globalThis & { __NEUTRX_OTEL_API__?: unknown };

void test('PluginManager handles lifecycle, hooks, duplicate use, and wrong contexts', async () => {
    const { default: Neutrx, PluginManager } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        adapter: config => ({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from('{}'),
            config,
        }),
    });
    const manager = new PluginManager(api as never);
    let installs = 0;
    let uninstalls = 0;

    assert.throws(() => manager.use({ name: '' }), /Plugin must have a name/u);
    manager.use({
        name: 'lifecycle',
        version: '1.0.0',
        install(_client, pluginApi) {
            installs += 1;
            pluginApi.addHook('beforeRequest', config => ({
                ...config,
                headers: { ...config.headers, 'X-Hook': 'before' },
            }));
            pluginApi.addHook('afterRequest', response => ({
                ...response,
                headers: { ...response.headers, 'x-hook': 'after' },
            }));
            pluginApi.addHook('onError', error => Object.assign(error, { hooked: true }));
            pluginApi.addInterceptor(config => config);
        },
        uninstall() {
            uninstalls += 1;
        },
    });
    manager.use({ name: 'lifecycle' });

    const config = await manager.runHook('beforeRequest', requestConfig());
    const response = await manager.runHook('afterRequest', responseConfig(config));
    const error = await manager.runHook('onError', new Error('boom')) as Error & { readonly hooked?: boolean };
    const wrongContext = new Error('wrong');

    assert.equal(installs, 1);
    assert.equal(config.headers['X-Hook'], 'before');
    assert.equal(response.headers['x-hook'], 'after');
    assert.equal(error.hooked, true);
    assert.equal(await manager.runHook('beforeRequest', wrongContext as never), wrongContext);
    assert.deepEqual(manager.list().map(plugin => ({ name: plugin.name, version: plugin.version })), [
        { name: 'lifecycle', version: '1.0.0' },
    ]);
    manager.unuse('lifecycle');
    manager.unuse('missing');
    assert.equal(uninstalls, 1);
    assert.deepEqual(manager.list(), []);
});

void test('MockPlugin returns registered responses', async () => {
    const { default: Neutrx, MockPlugin } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({ baseURL: 'https://api.example.com' });
    api.use(MockPlugin);
    api.mock?.enable().register('/mocked', { data: { ok: true } });

    const response = await api.get('/mocked');
    assert.deepEqual(response.data, { ok: true });
});

void test('MockPlugin supports disable, clear, regex patterns, delays, and fallback dispatch', async () => {
    const { default: Neutrx, MockPlugin } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        baseURL: 'https://api.example.com',
        adapter: config => ({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(JSON.stringify({ real: config.url })),
            config,
        }),
    });
    api.use(MockPlugin);
    api.mock?.register(/\/users\/\d+$/u, {
        status: 201,
        statusText: 'Created',
        headers: { 'x-mock': 'yes' },
        data: { mocked: true },
        delay: 1,
    });

    assert.deepEqual((await api.get('/users/1')).data, { real: 'https://api.example.com/users/1' });
    api.mock?.enable();
    const mocked = await api.get('/users/2');
    assert.equal(mocked.status, 201);
    assert.equal(mocked.statusText, 'Created');
    assert.equal(mocked.headers['x-mock'], 'yes');
    assert.deepEqual(mocked.data, { mocked: true });

    api.mock?.disable();
    assert.deepEqual((await api.get('/users/3')).data, { real: 'https://api.example.com/users/3' });
    api.mock?.enable().clear();
    assert.deepEqual((await api.get('/users/4')).data, { real: 'https://api.example.com/users/4' });
});

void test('GraphQLPlugin unwraps GraphQL data and surfaces errors', async () => {
    const { default: Neutrx, GraphQLPlugin } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        adapter: config => ({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(config.url.endsWith('/bad')
                ? JSON.stringify({ errors: [{ message: 'bad query' }] })
                : JSON.stringify({ data: { viewer: { id: '1' } }, extensions: { cost: 1 } })),
            config,
        }),
    });
    api.use(GraphQLPlugin);

    const response = await api.gql?.('https://api.example.com/graphql', '{ viewer { id } }');
    assert.deepEqual(response?.data, { viewer: { id: '1' } });
    assert.deepEqual(response?.extensions, { cost: 1 });
    await assert.rejects(api.gql?.('https://api.example.com/bad', '{ bad }') ?? Promise.resolve(), /GraphQL Error/u);
});

void test('GraphQLPlugin forwards variables, operationName, headers, and partial error data', async () => {
    const { default: Neutrx, GraphQLPlugin } = await import(builtEntry) as typeof PackageEntry;
    const seen: Array<{ readonly body: unknown; readonly headers: PackageEntry.Headers }> = [];
    const api = Neutrx.create({
        adapter: config => {
            seen.push({ body: config.data, headers: config.headers });
            return {
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                data: Buffer.from(config.url.endsWith('/partial')
                    ? JSON.stringify({ data: { viewer: null }, errors: [{ message: 'partial' }] })
                    : JSON.stringify({ data: { viewer: { id: config.headers['X-Test'] } } })),
                config,
            };
        },
    });
    api.use(GraphQLPlugin);

    const response = await api.gql?.(
        'https://api.example.com/graphql',
        '  query Viewer($id: ID!) { viewer(id: $id) { id } }  ',
        { id: '1' },
        { operationName: 'Viewer', headers: { 'X-Test': 'ok' } }
    );
    assert.deepEqual(response?.data, { viewer: { id: 'ok' } });
    assert.deepEqual(seen[0]?.body, {
        query: 'query Viewer($id: ID!) { viewer(id: $id) { id } }',
        variables: { id: '1' },
        operationName: 'Viewer',
    });
    assert.equal(seen[0]?.headers['X-Test'], 'ok');

    await assert.rejects(
        api.gql?.('https://api.example.com/partial', '{ viewer { id } }') ?? Promise.resolve(),
        error => error instanceof Error
            && 'graphQLErrors' in error
            && 'data' in error
            && (error as { readonly data?: unknown }).data !== undefined
    );
});

void test('OAuth2Plugin fetches token and injects bearer auth', async () => {
    const { default: Neutrx, OAuth2Plugin } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        adapter: config => ({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(config.url.endsWith('/token')
                ? JSON.stringify({ access_token: 'token-1', expires_in: 3600 })
                : JSON.stringify({ authorization: config.headers.Authorization })),
            config,
        }),
    });
    api.use(OAuth2Plugin);
    api.configureOAuth2?.({ tokenURL: 'https://auth.example.com/token' });

    const response = await api.get('https://api.example.com/secure');
    assert.deepEqual(response.data, { authorization: 'Bearer token-1' });
});

void test('OAuth2Plugin refreshes tokens inside the refresh window', async () => {
    const { default: Neutrx, OAuth2Plugin } = await import(builtEntry) as typeof PackageEntry;
    let tokenCalls = 0;
    const api = Neutrx.create({
        performance: { enableCaching: false },
        adapter: config => {
            if (config.url.endsWith('/token')) {
                tokenCalls += 1;
                return {
                    status: 200,
                    statusText: 'OK',
                    headers: { 'content-type': 'application/json' },
                    data: Buffer.from(JSON.stringify({ access_token: `token-${tokenCalls}`, expires_in: 1 })),
                    config,
                };
            }

            return {
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                data: Buffer.from(JSON.stringify({ authorization: config.headers.Authorization })),
                config,
            };
        },
    });
    api.use(OAuth2Plugin);
    api.configureOAuth2?.({ tokenURL: 'https://auth.example.com/token' });

    const first = await api.get('https://api.example.com/secure');
    const second = await api.get('https://api.example.com/secure');

    assert.equal(tokenCalls, 2);
    assert.deepEqual(first.data, { authorization: 'Bearer token-1' });
    assert.deepEqual(second.data, { authorization: 'Bearer token-2' });
});

void test('OAuth2Plugin supports custom token payloads and rejects missing tokens', async () => {
    const { default: Neutrx, OAuth2Plugin } = await import(builtEntry) as typeof PackageEntry;
    let tokenPayload: unknown;
    let tokenHeaders: PackageEntry.Headers | undefined;
    const api = Neutrx.create({
        adapter: config => {
            if (config.url.endsWith('/token')) {
                tokenPayload = config.data;
                tokenHeaders = config.headers;
                return {
                    status: 200,
                    statusText: 'OK',
                    headers: { 'content-type': 'application/json' },
                    data: Buffer.from(JSON.stringify({ access_token: 'custom-token', expires_in: 3600 })),
                    config,
                };
            }
            return {
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                data: Buffer.from(JSON.stringify({ authorization: config.headers.Authorization ?? null })),
                config,
            };
        },
    });
    api.use(OAuth2Plugin);

    assert.deepEqual((await api.get('https://api.example.com/public')).data, { authorization: null });
    api.configureOAuth2?.({
        tokenURL: 'https://auth.example.com/token',
        grantType: 'client_credentials',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        scope: 'read write',
    });
    assert.deepEqual((await api.get('https://api.example.com/secure')).data, { authorization: 'Bearer custom-token' });
    assert.deepEqual(tokenPayload, {
        grant_type: 'client_credentials',
        client_id: 'client-id',
        client_secret: 'client-secret',
        scope: 'read write',
    });
    assert.equal(tokenHeaders?.['Content-Type'], 'application/x-www-form-urlencoded');

    const missing = Neutrx.create({
        adapter: config => ({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(config.url.endsWith('/token') ? '{}' : '{"ok":true}'),
            config,
        }),
    });
    missing.use(OAuth2Plugin);
    missing.configureOAuth2?.({ tokenURL: 'https://auth.example.com/token' });
    await assert.rejects(missing.get('https://api.example.com/secure'), /missing access_token/u);
});

void test('ValidationPlugin validates and transforms request and response data', async () => {
    const { default: Neutrx, NeutrxValidationError, ValidationPlugin } = await import(builtEntry) as typeof PackageEntry;
    let seenName: string | undefined;
    const api = Neutrx.create({
        adapter: config => {
            seenName = typeof config.data === 'object' && config.data !== null && 'name' in config.data
                ? String((config.data as { readonly name: unknown }).name)
                : undefined;
            return {
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                data: Buffer.from(JSON.stringify({ id: 123, name: seenName })),
                config,
            };
        },
    });
    api.use(ValidationPlugin);
    api.configureValidation?.({
        request: {
            parse(value) {
                if (!isRecord(value) || typeof value.name !== 'string' || value.name.trim() === '') {
                    throw Object.assign(new Error('name is required'), {
                        issues: [{ path: ['name'], message: 'name is required', code: 'required' }],
                    });
                }
                return { ...value, name: value.name.trim() };
            },
        },
        response: {
            safeParse(value) {
                if (!isRecord(value) || typeof value.id !== 'number') {
                    return { success: false, issues: [{ path: ['id'], message: 'id must be number' }] };
                }
                return { success: true, data: { ...value, id: String(value.id) } };
            },
        },
    });

    await assert.rejects(
        api.post('https://api.example.com/users', { name: '   ' }),
        error => error instanceof NeutrxValidationError
            && error.phase === 'request'
            && error.issues[0]?.path?.[0] === 'name'
    );

    const response = await api.post('https://api.example.com/users', { name: ' Ada ' });
    assert.equal(seenName, 'Ada');
    assert.deepEqual(response.data, { id: '123', name: 'Ada' });
});

void test('ValidationPlugin handles pass-through, deletion, false results, and unsupported schemas', async () => {
    const { default: Neutrx, NeutrxValidationError, ValidationPlugin } = await import(builtEntry) as typeof PackageEntry;
    const seenData: unknown[] = [];
    const api = Neutrx.create({
        adapter: config => {
            seenData.push(config.data);
            return {
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                data: Buffer.from(JSON.stringify({ ok: true })),
                config,
            };
        },
    });
    api.use(ValidationPlugin);
    api.configureValidation?.({
        request: () => undefined,
        response: { safeParse: () => ({ success: true }) },
    });

    const pass = await api.post('https://api.example.com/pass', { keep: true });
    assert.deepEqual(seenData[0], { keep: true });
    assert.deepEqual(pass.data, { ok: true });

    await api.post('https://api.example.com/delete', { remove: true }, {
        validation: { request: { safeParse: () => ({ success: true, data: undefined }) } },
    });
    assert.equal(seenData[1], undefined);

    await assert.rejects(
        api.post('https://api.example.com/false', { bad: true }, {
            validation: {
                request: Object.assign(() => false, {
                    errors: [{ path: '/bad/value', message: 'bad value', code: 'bad' }],
                }),
            },
        }),
        error => error instanceof NeutrxValidationError
            && error.issues[0]?.path?.join('.') === 'bad.value'
            && error.issues[0]?.code === 'bad'
    );

    await assert.rejects(
        api.post('https://api.example.com/unsupported', { bad: true }, {
            validation: { request: {} as PackageEntry.ValidationSchema },
        }),
        error => error instanceof NeutrxValidationError
            && error.issues[0]?.message === 'Unsupported validation schema'
    );
});

void test('ValidationPlugin supports TypeBox-style Check and Errors per request', async () => {
    const { default: Neutrx, NeutrxValidationError, ValidationPlugin } = await import(builtEntry) as typeof PackageEntry;
    const api = Neutrx.create({
        adapter: config => ({
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(JSON.stringify({ ok: false })),
            config,
        }),
    });
    api.use(ValidationPlugin);

    await assert.rejects(
        api.get('https://api.example.com/status', {
            validation: {
                response: {
                    Check(value: unknown) {
                        return isRecord(value) && value.ok === true;
                    },
                    Errors() {
                        return [{ path: ['ok'], message: 'ok must be true', code: 'literal' }];
                    },
                },
            },
        }),
        error => error instanceof NeutrxValidationError
            && error.phase === 'response'
            && error.issues[0]?.code === 'literal'
    );
});

void test('WebSocketPlugin resolves URLs, sends messages, and reconnects', async () => {
    const { default: Neutrx, WebSocketPlugin } = await import(builtEntry) as typeof PackageEntry;
    FakeWebSocket.reset();

    const api = Neutrx.create({ baseURL: 'https://api.example.com' });
    api.use(WebSocketPlugin);

    const messages: unknown[] = [];
    const closes: number[] = [];
    const connection = await api.ws('/realtime', {
        webSocket: FakeWebSocket as unknown as typeof WebSocket,
        reconnect: { attempts: 1, delay: 1, backoff: 'fixed', maxDelay: 1 },
        onMessage: data => messages.push(data),
        onClose: event => closes.push(event.code),
    });

    assert.equal(connection.url, 'wss://api.example.com/realtime');
    assert.equal(FakeWebSocket.instances.length, 1);
    assert.throws(() => connection.send('early'), /WebSocket is not open/u);

    FakeWebSocket.instances[0]?.open();
    connection.send('hello');
    FakeWebSocket.instances[0]?.message('ping');
    FakeWebSocket.instances[0]?.serverClose(1006);
    await sleep(5);

    assert.deepEqual(FakeWebSocket.sent, ['hello']);
    assert.deepEqual(messages, ['ping']);
    assert.deepEqual(closes, [1006]);
    assert.equal(FakeWebSocket.instances.length, 2);
    connection.close();
});

void test('WebSocketPlugin covers unavailable runtime, protocol guard, and disabled reconnect', async () => {
    const { default: Neutrx, WebSocketPlugin } = await import(builtEntry) as typeof PackageEntry;
    FakeWebSocket.reset();

    const api = Neutrx.create({ baseURL: 'https://api.example.com' });
    api.use(WebSocketPlugin);

    const webSocketGlobal = globalThis as unknown as { WebSocket: typeof WebSocket | undefined };
    const originalWebSocket = webSocketGlobal.WebSocket;
    webSocketGlobal.WebSocket = undefined;
    try {
        await assert.rejects(api.ws('/missing'), /WebSocket is unavailable/u);
    } finally {
        webSocketGlobal.WebSocket = originalWebSocket;
    }
    const ftpApi = Neutrx.create({ baseURL: 'ftp://api.example.com' });
    ftpApi.use(WebSocketPlugin);
    await assert.rejects(
        ftpApi.ws('/realtime', { webSocket: FakeWebSocket as unknown as typeof WebSocket }),
        /Unsupported protocol/u
    );

    const connection = await Neutrx.create({ security: { profile: 'legacy' } }).ws('ws://api.example.com/realtime', {
        webSocket: FakeWebSocket as unknown as typeof WebSocket,
        reconnect: false,
    });
    FakeWebSocket.instances[0]?.serverClose(1000);
    await sleep(5);
    assert.equal(FakeWebSocket.instances.length, 1);
    assert.equal(connection.readyState, FakeWebSocket.CLOSED);
    connection.close();
});

void test('LogPlugin writes structured success and error entries', async () => {
    const { default: Neutrx, LogPlugin } = await import(builtEntry) as typeof PackageEntry;
    const info: Array<Record<string, PackageEntry.NeutrxLogValue>> = [];
    const errors: Array<Record<string, PackageEntry.NeutrxLogValue>> = [];
    const api = Neutrx.create({
        resilience: { enableRetry: false },
        adapter: config => ({
            status: config.url.endsWith('/fail') ? 500 : 200,
            statusText: config.url.endsWith('/fail') ? 'Server Error' : 'OK',
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(JSON.stringify({ ok: !config.url.endsWith('/fail') })),
            config,
        }),
    });

    api.use(LogPlugin);
    api.setLogger({
        info: entry => info.push(entry),
        error: entry => errors.push(entry),
    });

    await api.get('https://api.example.com/ok');
    await assert.rejects(api.get('https://api.example.com/fail'), /HTTP 500/u);

    assert.equal(info[0]?.method, 'GET');
    assert.equal(info[0]?.status, 200);
    assert.equal(info[0]?.attempts, 1);
    assert.equal(errors[0]?.code, 'HTTP_500');
    assert.equal(errors[0]?.url, 'https://api.example.com/fail');
});

void test('OtelPlugin enables OpenTelemetry instrumentation through plugin install', async () => {
    const { default: Neutrx, OtelPlugin } = await import(builtEntry) as typeof PackageEntry;
    const attributes: Record<string, string | number | boolean> = {};
    let ended = false;

    (globalThis as OTelGlobal).__NEUTRX_OTEL_API__ = {
        trace: {
            getTracer: () => ({
                startSpan: () => ({
                    setAttribute: (name: string, value: string | number | boolean) => {
                        attributes[name] = value;
                    },
                    setStatus: () => undefined,
                    end: () => {
                        ended = true;
                    },
                }),
            }),
        },
        propagation: {
            inject: (_context: unknown, carrier: Record<string, string>) => {
                carrier.traceparent = '00-plugin';
            },
        },
        context: { active: () => ({}) },
        SpanStatusCode: { ERROR: 2, OK: 1 },
    };

    try {
        const api = Neutrx.create({
            adapter: config => ({
                status: 200,
                statusText: 'OK',
                headers: { 'content-type': 'application/json' },
                data: Buffer.from(JSON.stringify({ trace: config.headers.traceparent })),
                config,
            }),
        });

        api.use(OtelPlugin);

        const response = await api.get('https://api.example.com/otel');
        assert.deepEqual(response.data, { trace: '00-plugin' });
        assert.equal(attributes['http.request.method'], 'GET');
        assert.equal(attributes['url.path'], '/otel');
        assert.equal(attributes['http.response.status_code'], 200);
        assert.equal(ended, true);
    } finally {
        delete (globalThis as OTelGlobal).__NEUTRX_OTEL_API__;
    }
});

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    static instances: FakeWebSocket[] = [];
    static sent: PackageEntry.NeutrxWebSocketMessage[] = [];

    readonly url: string;
    readonly protocols?: string | readonly string[];
    readyState = FakeWebSocket.CONNECTING;
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;

    constructor(url: string | URL, protocols?: string | readonly string[]) {
        this.url = String(url);
        if (protocols !== undefined) this.protocols = protocols;
        FakeWebSocket.instances.push(this);
    }

    static reset(): void {
        FakeWebSocket.instances = [];
        FakeWebSocket.sent = [];
    }

    open(): void {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.({ type: 'open' } as Event);
    }

    message(data: unknown): void {
        this.onmessage?.({ data } as MessageEvent);
    }

    serverClose(code: number): void {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.({ code, reason: '', wasClean: false } as CloseEvent);
    }

    send(data: PackageEntry.NeutrxWebSocketMessage): void {
        FakeWebSocket.sent.push(data);
    }

    close(code = 1000, reason = ''): void {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.({ code, reason, wasClean: true } as CloseEvent);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function requestConfig(): InternalRequestConfig {
    return {
        url: 'https://api.example.com',
        method: 'GET',
        headers: {} as InternalRequestConfig['headers'],
        allowAbsoluteUrls: true,
        timeout: 1000,
        connectTimeout: 1000,
        maxRedirects: 0,
        maxContentLength: 1024,
        maxBodyLength: 1024,
        responseType: 'json',
        responseEncoding: 'utf8',
        validateStatus: status => status >= 200 && status < 300,
        throwHttpErrors: true,
        decompress: true,
        transitional: { clarifyTimeoutError: false },
        followRedirects: true,
        requestId: 'req-1',
        startTime: Date.now(),
        hops: 0,
    };
}

function responseConfig(config: InternalRequestConfig): NeutrxResponse {
    return {
        status: 200,
        statusText: 'OK',
        headers: {},
        data: {},
        config,
        requestId: config.requestId,
        timing: { duration: 1 },
    };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import type * as ErrorModule from '../../../src/core/NeutrxError.js';
import type InterceptorChainType from '../../../src/interceptors/InterceptorChain.js';
import type { InternalRequestConfig, NeutrxResponse } from '../../../src/types.js';

const errorsEntry = '../../../../dist/core/NeutrxError.mjs';
const interceptorEntry = '../../../../dist/interceptors/InterceptorChain.mjs';

void test('error classes expose metadata and redact JSON output', async () => {
    const errors = await import(errorsEntry) as typeof ErrorModule;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
        const base = new errors.NeutrxError('failed?token=secret', {
            code: 'BASE',
            url: 'https://user:pass@example.com/path?token=secret&ok=1',
            method: 'GET',
            traceContext: {
                traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                spanId: 'bbbbbbbbbbbbbbbb',
                sampled: true,
            },
            cause: new Error('cause?token=secret'),
            context: {
                Authorization: 'Bearer secret',
                normal: 'ok',
            },
        });
        base.duration = 42;
        const json = base.toJSON();

        assert.equal(base.stack, 'NeutrxError: failed?token=secret');
        assert.equal(base.toString(), '[NeutrxError] BASE: failed?token=[REDACTED]');
        assert.equal(json.message, 'failed?token=[REDACTED]');
        assert.equal(json.category, 'unknown');
        assert.equal(json.traceId, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
        assert.equal(json.spanId, 'bbbbbbbbbbbbbbbb');
        assert.equal(json.url, 'https://%5BREDACTED%5D:%5BREDACTED%5D@example.com/path?token=%5BREDACTED%5D&ok=1');
        assert.equal((json.cause as { readonly message?: unknown }).message, 'cause?token=[REDACTED]');
        assert.deepEqual(json.context, {
            Authorization: '[REDACTED]',
            normal: 'ok',
        });
    } finally {
        if (previousNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = previousNodeEnv;
        }
    }

    const clientResponse = makeResponse(429, 'Too Many Requests', {
        'retry-after': ['1', '2'],
        authorization: 'Bearer secret',
    }, {
        token: 'secret',
        nested: { password: 'hidden' },
        buffer: Buffer.from('secret'),
        array: new Uint8Array([1, 2]),
    });
    const clientError = errors.NeutrxErrorFactory.fromHTTPStatus(clientResponse);
    const serverError = errors.NeutrxErrorFactory.fromHTTPStatus(makeResponse(503, 'Unavailable'));
    const neutralError = errors.NeutrxErrorFactory.fromHTTPStatus(makeResponse(302, 'Found'));
    const validation = new errors.NeutrxValidationError('response', [
        { path: ['user', 'token'], message: '?token=secret', code: 'bad_token' },
        { message: 'plain issue' },
    ]);

    assert.equal(clientError.name, 'NeutrxClientError');
    assert.equal(clientError.category, 'http');
    assert.equal(clientError.retryable, true);
    assert.equal(clientError.retryAfter, '1, 2');
    assert.equal(clientError.toJSON().response && typeof clientError.toJSON().response === 'object', true);
    assert.deepEqual((clientError.toJSON().response as { readonly headers: unknown }).headers, {
        'retry-after': ['1', '2'],
        authorization: '[REDACTED]',
    });
    assert.deepEqual((clientError.toJSON().response as { readonly data: unknown }).data, {
        token: '[REDACTED]',
        nested: { password: '[REDACTED]' },
        buffer: '[Buffer:6]',
        array: '[TypedArray:2]',
    });
    assert.equal(serverError.name, 'NeutrxServerError');
    assert.equal(serverError.retryable, true);
    assert.equal(neutralError.name, 'NeutrxHTTPError');
    assert.deepEqual(validation.toJSON().issues, [
        { path: ['user', 'token'], message: '?token=[REDACTED]', code: 'bad_token' },
        { message: 'plain issue' },
    ]);
    assert.equal(validation.category, 'validation');
    assert.deepEqual(errors.toStructuredError(Object.assign(new Error('failed?token=secret'), {
        code: 'ECONNRESET',
        url: 'https://api.example.com/path?token=secret',
    })), {
        name: 'Error',
        code: 'ECONNRESET',
        category: 'network',
        message: 'failed?token=[REDACTED]',
        requestId: null,
        url: 'https://api.example.com/path?token=%5BREDACTED%5D',
        method: null,
        retryable: false,
        duration: undefined,
        traceId: null,
        spanId: null,
    });

    const assorted = [
        new errors.NeutrxSSRFError('http://169.254.169.254/', 'metadata'),
        new errors.NeutrxCertPinError('api.example.com'),
        new errors.NeutrxInjectionError('header', 'X-Test'),
        new errors.NeutrxPrototypePollutionError('__proto__'),
        new errors.NeutrxRateLimitError('api.example.com'),
        new errors.NeutrxCircuitBreakerError('https://api.example.com', 1000),
        new errors.NeutrxMaxRetriesError(undefined, 3, new Error('last')),
        new errors.NeutrxBulkheadError('api.example.com', 5),
        new errors.NeutrxResponseSizeError(11, 10),
        new errors.NeutrxRequestSizeError(12, 10),
        new errors.NeutrxConnectTimeoutError('https://api.example.com', 50),
        new errors.NeutrxResponseTimeoutError('https://api.example.com', 60),
    ];
    assert.deepEqual(assorted.map(error => error.code), [
        'SSRF_BLOCKED',
        'CERT_PIN_MISMATCH',
        'INJECTION_DETECTED',
        'PROTOTYPE_POLLUTION',
        'RATE_LIMIT_EXCEEDED',
        'CIRCUIT_OPEN',
        'MAX_RETRIES_EXCEEDED',
        'BULKHEAD_FULL',
        'RESPONSE_TOO_LARGE',
        'REQUEST_TOO_LARGE',
        'CONNECT_TIMEOUT',
        'RESPONSE_TIMEOUT',
    ]);
    assert.deepEqual(assorted.map(error => error.toJSON()).map(json => json.code), assorted.map(error => error.code));
    assert.equal((assorted[0]?.toJSON() as { readonly severity?: unknown }).severity, 'CRITICAL');
    assert.equal((assorted[0]?.toJSON() as { readonly blockedURL?: unknown }).blockedURL, 'http://169.254.169.254/');
    assert.equal((assorted[2]?.toJSON() as { readonly injectionType?: unknown }).injectionType, 'header');
    assert.equal((assorted[6]?.toJSON() as { readonly attempts?: unknown }).attempts, 3);
    assert.equal(((assorted[6]?.toJSON() as { readonly lastError?: { readonly message?: unknown } }).lastError)?.message, 'last');
    assert.equal((assorted[8]?.toJSON() as { readonly size?: unknown; readonly limit?: unknown }).size, 11);
    assert.equal((assorted[8]?.toJSON() as { readonly size?: unknown; readonly limit?: unknown }).limit, 10);
    assert.equal((assorted[10]?.toJSON() as { readonly timeout?: unknown; readonly phase?: unknown }).timeout, 50);
    assert.equal((assorted[10]?.toJSON() as { readonly timeout?: unknown; readonly phase?: unknown }).phase, 'connect');
});

void test('error factory maps node errors to typed Neutrx errors', async () => {
    const {
        NeutrxErrorFactory,
        NeutrxConnectionRefusedError,
        NeutrxDNSError,
        NeutrxNetworkError,
        NeutrxSecurityError,
        NeutrxTimeoutError,
    } = await import(errorsEntry) as typeof ErrorModule;
    const config = { url: 'https://api.example.com/path', method: 'GET' };

    assert.ok(NeutrxErrorFactory.fromNodeError(nodeError('ECONNREFUSED'), config) instanceof NeutrxConnectionRefusedError);
    assert.ok(NeutrxErrorFactory.fromNodeError(nodeError('ENOTFOUND'), config) instanceof NeutrxDNSError);
    assert.ok(NeutrxErrorFactory.fromNodeError(nodeError('ETIMEDOUT'), config) instanceof NeutrxTimeoutError);
    assert.ok(NeutrxErrorFactory.fromNodeError(nodeError('ECONNRESET'), config) instanceof NeutrxNetworkError);
    assert.ok(NeutrxErrorFactory.fromNodeError(nodeError('ENETUNREACH'), config) instanceof NeutrxNetworkError);
    assert.ok(NeutrxErrorFactory.fromNodeError(nodeError('CERT_HAS_EXPIRED'), config) instanceof NeutrxSecurityError);
    assert.ok(NeutrxErrorFactory.fromNodeError(nodeError('DEPTH_ZERO_SELF_SIGNED_CERT'), config) instanceof NeutrxSecurityError);
    assert.equal(NeutrxErrorFactory.fromNodeError(nodeError(undefined), { url: 'not a url' }).url, 'not a url');
});

void test('interceptor chain covers manager clear/eject and rejection paths', async () => {
    const { default: InterceptorChain } = await import(interceptorEntry) as { readonly default: typeof InterceptorChainType };
    const chain = new InterceptorChain();
    const config = requestConfig();
    const managers = chain.managers();
    const order: string[] = [];

    managers.request.use(value => {
        order.push('skip');
        return value;
    }, undefined, { runWhen: () => false });
    const ejected = managers.request.use(value => {
        order.push('ejected');
        return value;
    });
    managers.request.eject(ejected);
    managers.request.use(() => {
        order.push('sync-throw');
        throw new Error('sync bad');
    }, error => {
        order.push(error.message);
        return { ...config, headers: { ...config.headers, recovered: 'yes' } };
    }, { synchronous: true });
    managers.request.use(value => {
        order.push('async');
        return Promise.resolve({ ...value, headers: { ...value.headers, async: 'yes' } });
    });

    const current = await chain.runRequest(config);
    assert.deepEqual(order, ['sync-throw', 'sync bad', 'async']);
    assert.equal(current.headers.recovered, 'yes');
    assert.equal(current.headers.async, 'yes');

    const okResponse = makeResponse(200, 'OK');
    managers.response.use(() => {
        throw new Error('response bad');
    }, error => ({
        ...okResponse,
        data: { handled: error.message },
    }));
    const handled = await chain.runResponse(okResponse);
    assert.deepEqual(handled.data, { handled: 'response bad' });

    managers.response.clear();
    managers.response.use(undefined, error => ({
        ...okResponse,
        data: { recovered: error.message },
    }));
    const recovered = await chain.runError(new Error('boom'));
    assert.deepEqual((recovered as NeutrxResponse).data, { recovered: 'boom' });

    managers.response.clear();
    managers.response.use(undefined, () => {
        throw new Error('next boom');
    });
    const unhandled = await chain.runError(new Error('first boom'));
    assert.equal(unhandled instanceof Error, true);
    assert.equal((unhandled as Error).message, 'next boom');

    managers.request.clear();
    assert.deepEqual(await chain.runRequest(config), config);
});

void test('request interceptors honor runWhen and registration order', async () => {
    const { default: InterceptorChain } = await import(interceptorEntry) as { readonly default: typeof InterceptorChainType };
    const chain = new InterceptorChain();
    const managers = chain.managers();
    const order: string[] = [];

    managers.request.use(config => {
        order.push('first');
        return { ...config, headers: { ...config.headers, first: 'yes' } };
    }, undefined, { synchronous: true });
    managers.request.use(config => {
        order.push('conditional');
        return { ...config, headers: { ...config.headers, conditional: 'yes' } };
    }, undefined, { runWhen: config => config.url.endsWith('/enabled') });
    managers.request.use(async config => {
        order.push('async');
        await Promise.resolve();
        return { ...config, headers: { ...config.headers, async: 'yes' } };
    });

    const enabled = await chain.runRequest({ ...requestConfig(), url: 'https://api.example.com/enabled' });
    assert.deepEqual(order, ['first', 'conditional', 'async']);
    assert.equal(enabled.headers.first, 'yes');
    assert.equal(enabled.headers.conditional, 'yes');
    assert.equal(enabled.headers.async, 'yes');

    order.length = 0;
    const skipped = await chain.runRequest({ ...requestConfig(), url: 'https://api.example.com/disabled' });
    assert.deepEqual(order, ['first', 'async']);
    assert.equal(skipped.headers.first, 'yes');
    assert.equal(skipped.headers.conditional, undefined);
    assert.equal(skipped.headers.async, 'yes');
});

void test('interceptor clear removes each group and preserves new registrations', async () => {
    const { default: InterceptorChain } = await import(interceptorEntry) as { readonly default: typeof InterceptorChainType };
    const chain = new InterceptorChain();
    const managers = chain.managers();
    const order: string[] = [];

    managers.request.use(config => {
        order.push('old-request');
        return config;
    });
    managers.response.use(response => {
        order.push('old-response');
        return response;
    });
    managers.request.clear();
    managers.response.clear();
    managers.request.use(config => {
        order.push('new-request');
        return config;
    });
    managers.response.use(response => {
        order.push('new-response');
        response.data = { replaced: true };
        return response;
    });

    await chain.runRequest(requestConfig());
    const response = await chain.runResponse(makeResponse(200, 'OK'));

    assert.deepEqual(order, ['new-request', 'new-response']);
    assert.deepEqual(response.data, { replaced: true });
});

void test('request interceptor rejection handlers recover and rethrow', async () => {
    const { default: InterceptorChain } = await import(interceptorEntry) as { readonly default: typeof InterceptorChainType };
    const recoveredChain = new InterceptorChain();
    const rethrowChain = new InterceptorChain();

    recoveredChain.addRequest(() => {
        throw new Error('request failed');
    }, error => ({
        ...requestConfig(),
        headers: { recovered: error.message },
    }));

    const recovered = await recoveredChain.runRequest(requestConfig());
    assert.equal(recovered.headers.recovered, 'request failed');

    rethrowChain.addRequest(() => {
        throw new Error('request failed');
    }, error => new Error(`wrapped ${error.message}`));

    await assert.rejects(
        rethrowChain.runRequest(requestConfig()),
        /wrapped request failed/u
    );
});

void test('sync and async request interceptors execute in registration order', async () => {
    const { default: InterceptorChain } = await import(interceptorEntry) as { readonly default: typeof InterceptorChainType };
    const chain = new InterceptorChain();
    const managers = chain.managers();
    const order: string[] = [];
    let asyncChainStarted = false;

    managers.request.use(config => {
        order.push(`sync:${String(asyncChainStarted)}`);
        return { ...config, headers: { ...config.headers, sync: 'yes' } };
    }, undefined, { synchronous: true });
    managers.request.use(async config => {
        asyncChainStarted = true;
        order.push('async-one');
        await Promise.resolve();
        return { ...config, headers: { ...config.headers, asyncOne: 'yes' } };
    });
    managers.request.use(config => {
        order.push('async-two');
        return { ...config, headers: { ...config.headers, asyncTwo: 'yes' } };
    }, undefined, { synchronous: true });

    const result = await chain.runRequest(requestConfig());

    assert.deepEqual(order, ['sync:false', 'async-one', 'async-two']);
    assert.equal(result.headers.sync, 'yes');
    assert.equal(result.headers.asyncOne, 'yes');
    assert.equal(result.headers.asyncTwo, 'yes');
});

void test('request runWhen sees config changes from earlier async interceptors', async () => {
    const { default: InterceptorChain } = await import(interceptorEntry) as { readonly default: typeof InterceptorChainType };
    const chain = new InterceptorChain();
    const managers = chain.managers();
    const order: string[] = [];

    managers.request.use(async config => {
        order.push('async');
        await Promise.resolve();
        return { ...config, headers: { ...config.headers, 'X-Async-Gate': 'open' } };
    });
    managers.request.use(config => {
        order.push('conditional');
        return { ...config, headers: { ...config.headers, conditional: 'yes' } };
    }, undefined, {
        runWhen: config => config.headers.get('X-Async-Gate') === 'open',
    });

    const result = await chain.runRequest(requestConfig());

    assert.deepEqual(order, ['async', 'conditional']);
    assert.equal(result.headers.conditional, 'yes');
});

function makeResponse(status: number, statusText: string, headers: Record<string, string | string[]> = {}, data: NeutrxResponse['data'] = {}): NeutrxResponse {
    return {
        status,
        statusText,
        headers,
        data,
        config: requestConfig(),
        requestId: 'req-1',
        timing: { duration: 1 },
    };
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

function nodeError(code: string | undefined): ErrorModule.NodeLikeError {
    return Object.assign(new Error(code ?? 'plain network error'), {
        ...(code ? { code } : {}),
        errno: code ?? 'ERR',
        syscall: 'connect',
    });
}

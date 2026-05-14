import http from 'node:http';

export function makeParams(count) {
    return Object.fromEntries(Array.from({ length: count }, (_, index) => [`field_${index}`, `value_${index}`]));
}

export function makeJsonPayload(items, textLength = 48) {
    const text = 'x'.repeat(textLength);
    return {
        id: 'payload',
        items: Array.from({ length: items }, (_, index) => ({
            id: index,
            name: `item-${index}`,
            enabled: index % 2 === 0,
            tags: [`tag-${index % 5}`, `group-${index % 11}`],
            meta: { score: index % 100, text },
        })),
    };
}

export function makeNestedPayload(depth) {
    let current = { value: 'leaf' };
    for (let index = 0; index < depth; index += 1) current = { [`level_${index}`]: current };
    return current;
}

export function makeHeaders(count) {
    return Object.fromEntries(Array.from({ length: count }, (_, index) => [`X-Bench-${index}`, `value-${index}`]));
}

export function makeRawAdapter(responseData = { ok: true }) {
    const body = Buffer.from(JSON.stringify(responseData));
    return async config => ({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json', 'content-length': String(body.byteLength) },
        data: body,
        config,
    });
}

export function makeFetch(responseData = { ok: true }) {
    const body = typeof responseData === 'string' ? responseData : JSON.stringify(responseData);
    return async () => new Response(body, {
        status: 200,
        statusText: 'OK',
        headers: {
            'content-type': 'application/json',
            'content-length': String(Buffer.byteLength(body)),
        },
    });
}

export function makeRoutingFetch(routes) {
    return async input => {
        const url = String(input);
        const matched = routes.find(route => url.includes(route.match));
        const data = matched?.data ?? { ok: true };
        const body = typeof data === 'function' ? JSON.stringify(data(url)) : JSON.stringify(data);
        return new Response(body, {
            status: matched?.status ?? 200,
            statusText: 'OK',
            headers: {
                'content-type': 'application/json',
                'content-length': String(Buffer.byteLength(body)),
            },
        });
    };
}

export async function withEchoServer(callback) {
    const server = http.createServer((request, response) => {
        let received = 0;
        request.on('data', chunk => {
            received += Buffer.byteLength(chunk);
        });
        request.on('end', () => {
            const body = JSON.stringify({ ok: true, received, method: request.method, url: request.url });
            response.writeHead(200, {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body),
            });
            response.end(body);
        });
    });

    await new Promise(resolve => {
        server.listen(0, '127.0.0.1', resolve);
    });

    try {
        const address = server.address();
        return await callback(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise(resolve => {
            server.close(resolve);
        });
    }
}

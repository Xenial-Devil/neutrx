import http from 'node:http';
import { performance } from 'node:perf_hooks';

const ITERATIONS = Number.parseInt(process.env.BENCH_ITERATIONS ?? '1000', 10);
const CONCURRENCY = Number.parseInt(process.env.BENCH_CONCURRENCY ?? '50', 10);
const LARGE_SIZE = Number.parseInt(process.env.BENCH_LARGE_SIZE ?? String(1024 * 1024), 10);

const { default: neutrx } = await import('../dist/esm/index.js');

const server = http.createServer((request, response) => {
  const chunks = [];
  request.on('data', chunk => chunks.push(chunk));
  request.on('end', () => {
    if (request.url === '/large') {
      response.setHeader('content-type', 'application/octet-stream');
      response.end(Buffer.alloc(LARGE_SIZE, 'a'));
      return;
    }

    if (request.url === '/stream') {
      response.setHeader('content-type', 'application/octet-stream');
      for (let index = 0; index < 16; index += 1) response.write(Buffer.alloc(16 * 1024, 's'));
      response.end();
      return;
    }

    if (request.url === '/retry') {
      response.statusCode = 503;
      response.setHeader('retry-after', '0');
      response.end('retry');
      return;
    }

    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      ok: true,
      method: request.method,
      bytes: Buffer.concat(chunks).length,
    }));
  });
});

await listen(server);
const address = server.address();
const baseURL = `http://127.0.0.1:${address.port}`;
const api = neutrx.create({
  baseURL,
  security: { profile: 'legacy', blockMetadataIPs: true },
  resilience: { enableRetry: false, enableCircuitBreaker: false },
  performance: { enableCaching: false },
});

const clients = [
  {
    name: 'neutrx',
    get: () => api.get('/json'),
    post: () => api.post('/json', { hello: 'world' }),
    large: () => api.get('/large', { responseType: 'buffer' }),
    stream: async () => {
      const response = await api.get('/stream', { responseType: 'stream' });
      await drainNodeStream(response.data);
    },
    retryOverhead: async () => {
      try {
        await api.get('/retry', { validateStatus: status => status < 500 });
      } catch {}
    },
  },
  {
    name: 'native fetch',
    get: () => fetch(`${baseURL}/json`).then(response => response.json()),
    post: () => fetch(`${baseURL}/json`, { method: 'POST', body: JSON.stringify({ hello: 'world' }) }).then(response => response.json()),
    large: () => fetch(`${baseURL}/large`).then(response => response.arrayBuffer()),
    stream: async () => {
      const response = await fetch(`${baseURL}/stream`);
      await drainWebStream(response.body);
    },
    retryOverhead: () => fetch(`${baseURL}/retry`),
  },
];

try {
  console.log(`HTTP client comparison, iterations=${ITERATIONS}, concurrency=${CONCURRENCY}`);
  for (const client of clients) {
    await bench(`${client.name} simple GET`, client.get, ITERATIONS);
    await bench(`${client.name} JSON POST`, client.post, ITERATIONS);
    await bench(`${client.name} concurrent GET`, () => runConcurrent(client.get, CONCURRENCY), Math.max(10, Math.floor(ITERATIONS / CONCURRENCY)));
    await bench(`${client.name} retry overhead`, client.retryOverhead, ITERATIONS);
    await bench(`${client.name} large response`, client.large, Math.max(10, Math.floor(ITERATIONS / 20)));
    await bench(`${client.name} stream response`, client.stream, Math.max(10, Math.floor(ITERATIONS / 20)));
  }
} finally {
  server.close();
}

async function bench(name, fn, iterations) {
  if (global.gc) global.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) await fn();
  const duration = performance.now() - start;
  const heapAfter = process.memoryUsage().heapUsed;
  const ops = (iterations / duration) * 1000;
  console.log(`${name.padEnd(34)} ${ops.toFixed(0).padStart(8)} ops/sec  heapDelta=${formatBytes(heapAfter - heapBefore)}`);
}

async function runConcurrent(fn, count) {
  await Promise.all(Array.from({ length: count }, () => fn()));
}

function listen(target) {
  return new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
}

function drainNodeStream(stream) {
  return new Promise((resolve, reject) => {
    stream.on('data', () => {});
    stream.on('end', resolve);
    stream.on('error', reject);
  });
}

async function drainWebStream(stream) {
  if (!stream) return;
  const reader = stream.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) return;
  }
}

function formatBytes(bytes) {
  const sign = bytes < 0 ? '-' : '';
  const value = Math.abs(bytes);
  if (value < 1024) return `${sign}${value}b`;
  if (value < 1024 * 1024) return `${sign}${(value / 1024).toFixed(1)}kb`;
  return `${sign}${(value / 1024 / 1024).toFixed(1)}mb`;
}

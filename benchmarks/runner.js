import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const DEFAULT_OPTIONS = {
    warmupMs: 150,
    minTimeMs: 700,
    minIterations: 25,
    maxIterations: 5000,
    operationsPerIteration: 1,
};

export async function runSuite({ name, benchmarks, outputName, notes = [] }) {
    const results = [];
    const startedAt = new Date();

    console.log(`\n${name}`);
    console.log('='.repeat(name.length));

    for (const benchmark of benchmarks) {
        const result = await measureBenchmark(benchmark);
        results.push(result);
        console.log(formatCliRow(result));
    }

    await writeReports({ name, outputName, notes, startedAt, results });
    return results;
}

async function measureBenchmark(benchmark) {
    const options = { ...DEFAULT_OPTIONS, ...(benchmark.options ?? {}) };
    await runLoop(benchmark.fn, { ...options, collectSamples: false, warmupOnly: true });

    if (typeof globalThis.gc === 'function') globalThis.gc();
    const heapBefore = process.memoryUsage().heapUsed;
    const measured = await runLoop(benchmark.fn, { ...options, collectSamples: true, warmupOnly: false });
    if (typeof globalThis.gc === 'function') globalThis.gc();
    const heapAfter = process.memoryUsage().heapUsed;

    const logicalOperations = measured.iterations * options.operationsPerIteration;
    const totalSeconds = measured.totalMs / 1000;
    const samples = measured.samples.map(sample => sample / options.operationsPerIteration);

    return {
        name: benchmark.name,
        category: benchmark.category ?? 'core',
        inputSize: benchmark.inputSize ?? 'n/a',
        iterations: measured.iterations,
        logicalOperations,
        totalMs: measured.totalMs,
        opsPerSecond: logicalOperations / totalSeconds,
        avgMs: measured.totalMs / logicalOperations,
        minMs: Math.min(...samples),
        maxMs: Math.max(...samples),
        memoryDeltaBytes: heapAfter - heapBefore,
        notes: benchmark.notes ?? '',
    };
}

async function runLoop(fn, options) {
    const samples = [];
    let iterations = 0;
    let totalMs = 0;
    const targetMs = options.warmupOnly ? options.warmupMs : options.minTimeMs;
    const started = performance.now();

    while (
        iterations < options.minIterations
        || (performance.now() - started < targetMs && iterations < options.maxIterations)
    ) {
        const t0 = performance.now();
        await fn();
        const elapsed = performance.now() - t0;
        iterations += 1;
        totalMs += elapsed;
        if (options.collectSamples) samples.push(elapsed);
    }

    return { iterations, totalMs, samples };
}

async function writeReports({ name, outputName, notes, startedAt, results }) {
    const outputDir = path.join(process.cwd(), 'benchmark-results');
    await mkdir(outputDir, { recursive: true });

    const markdownPath = path.join(outputDir, `${outputName}.md`);
    const jsonPath = path.join(outputDir, `${outputName}.json`);
    await writeFile(markdownPath, renderMarkdown({ name, notes, startedAt, results }), 'utf8');
    await writeFile(jsonPath, `${JSON.stringify({ name, notes, startedAt, node: process.version, results }, null, 2)}\n`, 'utf8');
}

function renderMarkdown({ name, notes, startedAt, results }) {
    const rows = results.map(result => [
        result.name,
        result.category,
        result.inputSize,
        formatNumber(result.opsPerSecond),
        formatMs(result.avgMs),
        formatMs(result.minMs),
        formatMs(result.maxMs),
        formatBytes(result.memoryDeltaBytes),
        String(result.iterations),
    ]);

    return [
        `# ${name}`,
        '',
        `Generated: ${startedAt.toISOString()}`,
        `Node: ${process.version}`,
        `Benchmark harness: node:perf_hooks`,
        '',
        ...notes.map(note => `- ${note}`),
        notes.length > 0 ? '' : '',
        '| Scenario | Category | Input | Ops/sec | Avg ms/op | Min ms/op | Max ms/op | Heap delta | Iterations |',
        '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...rows.map(row => `| ${row.join(' | ')} |`),
        '',
    ].join('\n');
}

function formatCliRow(result) {
    return [
        result.name.padEnd(44),
        String(result.inputSize).padEnd(12),
        `${formatNumber(result.opsPerSecond)} ops/sec`.padStart(18),
        `${formatMs(result.avgMs)} ms/op`.padStart(16),
        `${formatBytes(result.memoryDeltaBytes)} heap`.padStart(16),
    ].join('  ');
}

function formatNumber(value) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function formatMs(value) {
    if (value < 0.001) return value.toFixed(6);
    if (value < 1) return value.toFixed(4);
    return value.toFixed(3);
}

function formatBytes(value) {
    const sign = value < 0 ? '-' : '';
    const absolute = Math.abs(value);
    if (absolute < 1024) return `${sign}${absolute} B`;
    if (absolute < 1024 * 1024) return `${sign}${(absolute / 1024).toFixed(1)} KiB`;
    return `${sign}${(absolute / 1024 / 1024).toFixed(2)} MiB`;
}

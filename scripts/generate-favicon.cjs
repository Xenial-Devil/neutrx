#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const bg = [11, 19, 32];
const teal = [45, 212, 191];
const blue = [23, 99, 230];
const purple = [124, 58, 237];

function mix(a, b, t) {
    return a.map((value, index) => Math.round(value + (b[index] - value) * t));
}

function blend(base, overlay, alpha) {
    return base.map((value, index) => Math.round(value * (1 - alpha) + overlay[index] * alpha));
}

function shieldColor(x, y) {
    const t = (x + y) / 360;
    return t < 0.52 ? mix(teal, blue, t / 0.52) : mix(blue, purple, (t - 0.52) / 0.48);
}

function insidePolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i];
        const b = points[j];
        if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) {
            inside = !inside;
        }
    }
    return inside;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
    const vx = bx - ax;
    const vy = by - ay;
    const wx = px - ax;
    const wy = py - ay;
    const c1 = vx * wx + vy * wy;
    const c2 = vx * vx + vy * vy;
    const t = Math.max(0, Math.min(1, c1 / c2));
    return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function sampleIcon(x, y) {
    let color = bg.slice();
    const shield = [
        [90, 16],
        [147, 37],
        [147, 82],
        [142, 111],
        [125, 137],
        [90, 164],
        [55, 146],
        [33, 118],
        [33, 82],
        [33, 37],
    ];
    const innerShield = [
        [90, 30],
        [134, 46],
        [134, 81],
        [129, 104],
        [116, 127],
        [90, 145],
        [64, 127],
        [46, 104],
        [46, 81],
        [46, 46],
    ];

    if (insidePolygon(x, y, shield)) color = shieldColor(x, y);
    if (insidePolygon(x, y, innerShield)) color = blend(color, [255, 255, 255], 0.12);

    const nDistance = Math.min(
        distanceToSegment(x, y, 61, 111, 61, 66),
        distanceToSegment(x, y, 61, 66, 119, 114),
        distanceToSegment(x, y, 119, 114, 119, 69)
    );
    if (nDistance <= 5) color = [245, 250, 255];

    const endpointDistance = Math.min(distanceToSegment(x, y, 60, 66, 80, 66), distanceToSegment(x, y, 118, 114, 144, 114));
    if (endpointDistance <= 3) color = [219, 234, 254];
    if (Math.hypot(x - 60, y - 66) <= 8 || Math.hypot(x - 136, y - 114) <= 8) color = [236, 254, 255];
    if (Math.hypot(x - 90, y - 140) <= 5) color = blend(color, [255, 255, 255], 0.75);

    return color;
}

function createDib(size) {
    const width = size;
    const height = size;
    const supersample = 4;
    const scale = 180 / size;
    const rgba = Buffer.alloc(width * height * 4);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let r = 0;
            let g = 0;
            let b = 0;
            for (let sy = 0; sy < supersample; sy++) {
                for (let sx = 0; sx < supersample; sx++) {
                    const color = sampleIcon((x + (sx + 0.5) / supersample) * scale, (y + (sy + 0.5) / supersample) * scale);
                    r += color[0];
                    g += color[1];
                    b += color[2];
                }
            }
            const offset = (y * width + x) * 4;
            const samples = supersample * supersample;
            rgba[offset] = Math.round(r / samples);
            rgba[offset + 1] = Math.round(g / samples);
            rgba[offset + 2] = Math.round(b / samples);
            rgba[offset + 3] = 255;
        }
    }

    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);
    header.writeInt32LE(width, 4);
    header.writeInt32LE(height * 2, 8);
    header.writeUInt16LE(1, 12);
    header.writeUInt16LE(32, 14);
    header.writeUInt32LE(0, 16);
    header.writeUInt32LE(width * height * 4, 20);

    const xorMask = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const source = ((height - 1 - y) * width + x) * 4;
            const target = (y * width + x) * 4;
            xorMask[target] = rgba[source + 2];
            xorMask[target + 1] = rgba[source + 1];
            xorMask[target + 2] = rgba[source];
            xorMask[target + 3] = rgba[source + 3];
        }
    }

    const andMask = Buffer.alloc(Math.ceil(width / 32) * 4 * height);
    return Buffer.concat([header, xorMask, andMask]);
}

function createIco() {
    const images = [16, 32, 48].map(size => ({ size, dib: createDib(size) }));
    const directory = Buffer.alloc(6);
    const entries = Buffer.alloc(16 * images.length);
    directory.writeUInt16LE(0, 0);
    directory.writeUInt16LE(1, 2);
    directory.writeUInt16LE(images.length, 4);

    let offset = 6 + entries.length;
    images.forEach((image, index) => {
        const entry = index * 16;
        entries[entry] = image.size;
        entries[entry + 1] = image.size;
        entries[entry + 2] = 0;
        entries[entry + 3] = 0;
        entries.writeUInt16LE(1, entry + 4);
        entries.writeUInt16LE(32, entry + 6);
        entries.writeUInt32LE(image.dib.length, entry + 8);
        entries.writeUInt32LE(offset, entry + 12);
        offset += image.dib.length;
    });

    return Buffer.concat([directory, entries, ...images.map(image => image.dib)]);
}

function writeFile(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
}

const ico = createIco();
writeFile(path.join(root, 'docs', 'favicon.ico'), ico);

const siteDir = path.join(root, 'docs', '_site');
if (fs.existsSync(siteDir)) {
    writeFile(path.join(siteDir, 'favicon.ico'), ico);
    fs.copyFileSync(path.join(root, 'docs', 'favicon.svg'), path.join(siteDir, 'favicon.svg'));
}

console.log(`Generated docs/favicon.ico (${ico.length} bytes)`);

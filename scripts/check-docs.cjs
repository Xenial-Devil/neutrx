#!/usr/bin/env node
'use strict';

/**
 * Dependency-free docs validator for the GitHub Pages (Jekyll / just-the-docs)
 * site served directly from /docs. No build step — this just verifies:
 *   1. every Markdown page starts with a YAML front-matter block,
 *   2. every page has a useful SEO description,
 *   3. every relative Markdown link resolves to an existing file,
 *   4. parent/child nav wiring is consistent (every `parent:` has a matching
 *      `title:` on a `has_children: true` page).
 * Exits non-zero on any problem so it can gate `validate` / `ci`.
 */

const fs = require('node:fs');
const path = require('node:path');

const DOCS = path.join(__dirname, '..', 'docs');
const errors = [];

/** Recursively collect *.md files under docs/, skipping generated output. */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_site') || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function parseFrontMatter(text, rel) {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    errors.push(`${rel}: missing front-matter block`);
    return {};
  }
  const end = text.indexOf('\n---', 3);
  if (end === -1) {
    errors.push(`${rel}: unterminated front-matter block`);
    return {};
  }
  const fm = {};
  for (const line of text.slice(4, end).split('\n')) {
    const m = /^([A-Za-z_]+):\s*(.*)$/.exec(line.trim());
    if (m) fm[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return fm;
}

const files = walk(DOCS);
const titles = new Set();
const hasChildrenTitles = new Set();
const parents = [];

for (const file of files) {
  const rel = path.relative(DOCS, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');
  const fm = parseFrontMatter(text, rel);
  if (fm.title) titles.add(fm.title);
  if (!fm.description) {
    errors.push(`${rel}: missing SEO description`);
  } else if (fm.description.length < 50 || fm.description.length > 180) {
    errors.push(`${rel}: SEO description should be 50-180 characters`);
  }
  if (String(fm.has_children) === 'true' && fm.title) hasChildrenTitles.add(fm.title);
  if (fm.parent) parents.push({ rel, parent: fm.parent });

  // Validate relative markdown links: [text](target.md) / (target.md#anchor)
  const linkRe = /\]\(([^)]+)\)/g;
  let m;
  while ((m = linkRe.exec(text)) !== null) {
    let target = m[1].trim();
    if (/^(https?:|mailto:|#|\/)/.test(target)) continue; // external / absolute / anchor-only
    target = target.split('#')[0];
    if (!target || !target.endsWith('.md')) continue;
    const resolved = path.resolve(path.dirname(file), target);
    if (!fs.existsSync(resolved)) {
      errors.push(`${rel}: broken link -> ${m[1]}`);
    }
  }
}

for (const { rel, parent } of parents) {
  if (!titles.has(parent)) {
    errors.push(`${rel}: parent "${parent}" has no page with that title`);
  } else if (!hasChildrenTitles.has(parent)) {
    errors.push(`${rel}: parent "${parent}" exists but is not has_children: true`);
  }
}

if (errors.length) {
  console.error(`Docs check FAILED (${errors.length}):`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`Docs check passed: ${files.length} pages, front-matter + links + nav OK.`);

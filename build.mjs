#!/usr/bin/env node
// Builds dist/<target> from the single source in src/ plus manifests/<target>.json.
// Usage: node build.mjs [chrome|firefox|all] [--zip]

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const root = import.meta.dirname;
const TARGETS = ['chrome', 'firefox'];

const args = process.argv.slice(2);
const wantZip = args.includes('--zip');
const requested = args.find((arg) => !arg.startsWith('--')) ?? 'all';
const targets = requested === 'all' ? TARGETS : [requested];

for (const target of targets) {
  if (!TARGETS.includes(target)) {
    console.error(`Unknown target "${target}". Expected one of: ${TARGETS.join(', ')}, all.`);
    process.exit(1);
  }
}

async function build(target) {
  const out = path.join(root, 'dist', target);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  await cp(path.join(root, 'src'), out, { recursive: true });

  // Keep the manifest formatted the same way regardless of how it was authored.
  const manifest = JSON.parse(await readFile(path.join(root, 'manifests', `${target}.json`), 'utf8'));
  await writeFile(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`built dist/${target} (v${manifest.version})`);

  if (wantZip) {
    const zipPath = path.join(root, 'dist', `chatgpt-image-fanout-${target}.zip`);
    await rm(zipPath, { force: true });
    await run('zip', ['-qr', zipPath, '.'], { cwd: out });
    console.log(`packed dist/chatgpt-image-fanout-${target}.zip`);
  }
}

for (const target of targets) await build(target);

// MANIFESTO.md (repo root) is the only place the manifesto is edited.
// This script copies it into:
//   1. README.md, between the MANIFESTO:START / MANIFESTO:END markers
//   2. forum/src/manifesto.generated.js, which the home page renders
// Usage: node scripts/sync-manifesto.mjs          (write)
//        node scripts/sync-manifesto.mjs --check  (exit 1 if anything is out of date)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const PATHS = {
  source: join(here, '../../MANIFESTO.md'),
  readme: join(here, '../../README.md'),
  module: join(here, '../src/manifesto.generated.js'),
};
export const START = '<!-- MANIFESTO:START: generated from MANIFESTO.md by forum/scripts/sync-manifesto.mjs, edit that file instead -->';
export const END = '<!-- MANIFESTO:END -->';

export function readSource() {
  return readFileSync(PATHS.source, 'utf8').replace(/\r\n?/g, '\n').trim() + '\n';
}

// In the README the manifesto sits under the "# AngryDucks" title, so every heading drops one level.
export function readmeBlock(md) {
  const demoted = md.trim().replace(/^(#{1,5}) /gm, (_, h) => `#${h} `);
  return `${START}\n${demoted}\n${END}`;
}

export function moduleSource(md) {
  return `// Generated from MANIFESTO.md by scripts/sync-manifesto.mjs. Do not edit by hand.\nexport const MANIFESTO_MD = ${JSON.stringify(md)};\n`;
}

export function syncedReadme(readme, md) {
  const a = readme.indexOf('<!-- MANIFESTO:START');
  const b = readme.indexOf(END);
  if (a === -1 || b === -1 || b < a) throw new Error('README.md is missing the MANIFESTO:START / MANIFESTO:END markers');
  return readme.slice(0, a) + readmeBlock(md) + readme.slice(b + END.length);
}

function main() {
  const check = process.argv.includes('--check');
  const md = readSource();
  const readme = readFileSync(PATHS.readme, 'utf8');
  const wanted = { readme: syncedReadme(readme, md), module: moduleSource(md) };
  let current;
  try { current = readFileSync(PATHS.module, 'utf8'); } catch { current = ''; }
  const stale = [];
  if (wanted.readme !== readme) stale.push('README.md');
  if (wanted.module !== current) stale.push('forum/src/manifesto.generated.js');
  if (check) {
    if (stale.length) {
      console.error(`Out of date with MANIFESTO.md: ${stale.join(', ')}. Run: npm run sync`);
      process.exit(1);
    }
    console.log('Manifesto copies are in sync.');
    return;
  }
  writeFileSync(PATHS.readme, wanted.readme);
  writeFileSync(PATHS.module, wanted.module);
  console.log(stale.length ? `Updated: ${stale.join(', ')}` : 'Already in sync.');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();

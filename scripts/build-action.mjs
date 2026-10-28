import { isBuiltin } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';
const root = resolve(import.meta.dirname, '..');
const packageVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const sourceVersion = /export const VERSION = "([^"]+)"/.exec(readFileSync(resolve(root, 'src/version.ts'), 'utf8'))?.[1];
if (sourceVersion !== packageVersion) throw new Error('Package and CLI versions differ');
const runtime = resolve(root, 'action/runtime/jev-axi.mjs');
const result = await build({ absWorkingDir: root, entryPoints: ['bin/jev-axi.ts'], outfile: runtime,
  bundle: true, platform: 'node', target: 'node22', format: 'esm',
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  legalComments: 'eof', metafile: true, write: false });
for (const output of Object.values(result.metafile.outputs)) {
  for (const entry of output.imports) {
    if (entry.external && !isBuiltin(entry.path)) throw new Error(`Unbundled dependency: ${entry.path}`);
  }
}
const licenses = new Map([['jev-axi', readFileSync(resolve(root, 'LICENSE'), 'utf8')]]);
for (const input of Object.keys(result.metafile.inputs).filter(p => p.startsWith('node_modules/'))) {
  let dir = dirname(resolve(root, input));
  while (!existsSync(resolve(dir, 'package.json')) && dirname(dir) !== dir) dir = dirname(dir);
  const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'));
  const key = `${pkg.name}@${pkg.version}`;
  if (licenses.has(key)) continue;
  const files = readdirSync(dir).filter(n => /^licen[cs]e(?:$|[.-])/i.test(n)).sort();
  if (!files.length) throw new Error(`Missing license: ${key}`);
  licenses.set(key, files.map(n => readFileSync(resolve(dir, n), 'utf8')).join('\n'));
}
const notices = [...licenses].sort(([a],[b]) => a.localeCompare(b, 'en')).map(([n,t]) => `${n}\n${t.trim()}\n`).join('\n').replace(/\r\n/g, '\n');
for (const [path, contents] of [[runtime, result.outputFiles[0].text], [resolve(root, 'action/runtime/LICENSES.txt'), notices]]) {
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== contents) throw new Error('Stale Action runtime: run pnpm build:action and commit action/runtime/');
  } else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents); }
}

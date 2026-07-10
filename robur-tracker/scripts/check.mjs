import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const ignored = new Set(['node_modules', '.git', '.npm-cache', '.wrangler', '.wrangler-dry-run']);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

const files = await walk(root);
let failed = false;
for (const file of files) {
  if (extname(file) === '.js' || extname(file) === '.mjs') {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    failed ||= result.status !== 0;
  }
  if (extname(file) === '.json') {
    try { JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { console.error(`${file}: ${error.message}`); failed = true; }
  }
}

if (failed) process.exit(1);
console.log(`Syntax and JSON checks passed for ${files.length} project files.`);

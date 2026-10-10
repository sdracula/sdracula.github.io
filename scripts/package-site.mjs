import { readdir, cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('.');
const target = resolve(root, '_site');
await rm(target, { recursive: true, force: true });
await mkdir(target);
for (const entry of await readdir(root, { withFileTypes: true })) {
  // Never include checkout credentials or maintenance scripts in the public artifact.
  if (entry.name.startsWith('.') || ['_site', 'scripts'].includes(entry.name)) continue;
  await cp(resolve(root, entry.name), resolve(target, entry.name), { recursive: true, filter: source => !source.split(/[\\/]/).some(part => part.startsWith('.')) });
}
await cp(resolve(root, '.nojekyll'), resolve(target, '.nojekyll'));
console.log('Packaged static website without repository metadata');

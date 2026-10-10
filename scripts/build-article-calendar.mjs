import { readdir, access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(process.argv[2] || '.');
const days = {};
for (const year of await readdir(root, { withFileTypes: true })) {
  if (!year.isDirectory() || !/^20\d{2}$/.test(year.name)) continue;
  for (const month of await readdir(resolve(root, year.name), { withFileTypes: true })) {
    if (!month.isDirectory() || !/^\d{2}$/.test(month.name)) continue;
    for (const day of await readdir(resolve(root, year.name, month.name), { withFileTypes: true })) {
      if (!day.isDirectory() || !/^\d{2}$/.test(day.name)) continue;
      const date = year.name + '-' + month.name + '-' + day.name;
      for (const article of await readdir(resolve(root, year.name, month.name, day.name), { withFileTypes: true })) {
        // This generated Hexo repository stores articles as extensionless HTML files.
        if (article.isDirectory()) {
          try { await access(resolve(root, year.name, month.name, day.name, article.name, 'index.html')); }
          catch { continue; }
        } else if (!article.isFile() || (article.name.includes('.') && !article.name.endsWith('.html'))) continue;
        days[date] = (days[date] || 0) + 1;
      }
    }
  }
}
await mkdir(resolve(root, 'data'), { recursive: true });
await writeFile(resolve(root, 'data/article.json'), JSON.stringify({ version: 1, metric: 'articles', days }, null, 2) + '\n');
console.log('Article calendar: ' + Object.values(days).reduce((a, b) => a + b, 0) + ' published articles');

import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const owner = 'sdracula';
function field(body, name) {
  const match = body.match(new RegExp('### ' + name + '\\s*\\n([\\s\\S]*?)(?=\\n### |$)'));
  return match ? match[1].trim() : '';
}
export function fitnessEntries(issues, today) {
  return issues.filter(issue => !issue.pull_request && issue.state === 'open' && issue.user?.login === owner && issue.title.startsWith('[健身打卡]'))
    .flatMap(issue => {
      const body = typeof issue.body === 'string' ? issue.body : '';
      const date = field(body, '日期');
      const activity = field(body, '训练项目');
      const minutesText = field(body, '时长（分钟）');
      const minutes = Number(minutesText);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date || date > today ||
          !['力量训练', '跑步', '骑行', '游泳', '瑜伽 / 拉伸', '其他运动'].includes(activity) ||
          !/^\d+$/.test(minutesText) || minutes < 1 || minutes > 1440) return [];
      return [{ id: issue.number, date, activity, minutes }];
    });
}
export async function syncFitness(output, fetchImpl = fetch) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'PersonalActivityCalendar' };
  if (process.env.GH_TOKEN) headers.Authorization = 'Bearer ' + process.env.GH_TOKEN;
  const issues = [];
  for (let page = 1; page <= 100; page++) {
    const response = await fetchImpl('https://api.github.com/repos/sdracula/sdracula.github.io/issues?state=all&per_page=100&page=' + page, { headers, signal: AbortSignal.timeout(20000), redirect: 'error' });
    if (!response.ok) throw new Error('GitHub issues HTTP ' + response.status);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('Invalid GitHub issues response');
    issues.push(...batch);
    if (batch.length < 100) break;
    if (page === 100) throw new Error('Too many issue pages; previous snapshot retained');
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const entries = fitnessEntries(issues, today).sort((a, b) => a.date.localeCompare(b.date));
  const days = {};
  entries.forEach(entry => { days[entry.date] = (days[entry.date] || 0) + entry.minutes; });
  await mkdir(dirname(output), { recursive: true });
  const temporary = output + '.' + process.pid + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify({ version: 1, metric: 'training-minutes', lastSuccessfulSync: new Date().toISOString(), days, entries }, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, output);
  } finally { await unlink(temporary).catch(() => {}); }
  console.log('Fitness calendar: ' + entries.length + ' owner check-ins');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  syncFitness(resolve(process.argv[2] || 'data/fitness.json')).catch(error => { console.error('Fitness sync failed; previous snapshot preserved: ' + error.message); process.exitCode = 1; });
}

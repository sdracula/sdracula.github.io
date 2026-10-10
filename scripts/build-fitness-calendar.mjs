import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const startMarker = '<!-- fitness-records:start -->';
const endMarker = '<!-- fitness-records:end -->';
function cells(line) {
  if (!line.startsWith('|') || !line.endsWith('|')) throw new Error('表格行需以 | 开始和结束');
  return line.slice(1, -1).split(/(?<!\\)\|/).map(value => value.trim().replace(/\\\|/g, '|'));
}
export function parseFitness(source, today) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start < 0 || end <= start || source.indexOf(startMarker, start + 1) >= 0 || source.indexOf(endMarker, end + 1) >= 0) {
    throw new Error('请保留唯一的一对 fitness-records 表格标记');
  }
  const table = source.slice(start + startMarker.length, end).trim().split(/\r?\n/).filter(line => line.trim());
  if (table.length < 2 || cells(table[0].trim()).join(',') !== '日期,训练项目,时长（分钟）,备注' ||
      cells(table[1].trim()).length !== 4 || !cells(table[1].trim()).every(cell => /^:?-{3,}:?$/.test(cell))) {
    throw new Error('请保留健身表格的四列表头和分隔行');
  }
  const entries = table.slice(2).map((line, index) => {
    try {
      const row = cells(line.trim());
      if (row.length !== 4) throw new Error('需要日期、训练项目、分钟、备注四列');
      const [date, activity, duration, note] = row;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date || date > today) throw new Error('日期需为今天或过去的真实日期，格式 YYYY-MM-DD');
      if (!activity || activity.length > 80) throw new Error('训练项目需填写 1—80 个字符');
      if (!/^\d+$/.test(duration) || Number(duration) < 1 || Number(duration) > 1440) throw new Error('时长需为 1—1440 的整数分钟');
      if (note.length > 500) throw new Error('备注不能超过 500 个字符');
      return { date, activity, minutes: Number(duration), note };
    } catch (error) { throw new Error('第 ' + (index + 1) + ' 条健身记录：' + error.message); }
  });
  const days = {};
  entries.forEach(entry => { days[entry.date] = (days[entry.date] || 0) + entry.minutes; });
  return { days, entries };
}
export async function buildFitness(input, output, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  // Validate the whole source before replacing the last good snapshot.
  const records = parseFitness(await readFile(input, 'utf8'), today);
  await mkdir(dirname(output), { recursive: true });
  const temporary = output + '.' + process.pid + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify({ version: 1, metric: 'training-minutes', source: 'data/fitness.md', lastSuccessfulSync: now.toISOString(), ...records }, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, output);
  } finally { await unlink(temporary).catch(() => {}); }
  console.log('Fitness calendar: ' + records.entries.length + ' records from Markdown');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildFitness(resolve(process.argv[2] || 'data/fitness.md'), resolve(process.argv[3] || 'data/fitness.json'))
    .catch(error => { console.error('Fitness build failed; previous snapshot preserved: ' + error.message); process.exitCode = 1; });
}

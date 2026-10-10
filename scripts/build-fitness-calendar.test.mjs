import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseFitness, buildFitness } from './build-fitness-calendar.mjs';
const table = rows => '<!-- fitness-records:start -->\n| 日期 | 训练项目 | 时长（分钟） | 备注 |\n| --- | --- | --- | --- |\n' + rows.join('\n') + '\n<!-- fitness-records:end -->';
const today = '2026-10-10';

test('empty source excludes documentation examples; deleting rows cancels check-ins', () => {
  const source = table([]) + '\n```markdown\n| 2026-10-10 | 力量训练 | 45 | 示例 |\n```';
  assert.deepEqual(parseFitness(source, today), { days: {}, entries: [] });
  assert.deepEqual(parseFitness(table([]), today).days, {});
});
test('same-day workouts accumulate; leap dates and escaped note separators are retained', () => {
  const result = parseFitness(table([
    '| 2024-02-29 | 拉伸 | 15 | |',
    '| 2026-10-10 | 力量训练 | 45 | 胸部 \\| 三头肌 |',
    '| 2026-10-10 | 跑步 | 20 | |'
  ]), today);
  assert.deepEqual(result.days, { '2024-02-29': 15, '2026-10-10': 65 });
  assert.equal(result.entries[1].note, '胸部 | 三头肌');
});
test('invalid records fail with actionable row errors', () => {
  for (const row of [
    '| 2026-02-30 | 跑步 | 20 | |',
    '| 2026-10-11 | 跑步 | 20 | |',
    '| 2026-10-10 | | 20 | |',
    '| 2026-10-10 | 跑步 | 0 | |',
    '| 2026-10-10 | 跑步 | 1441 | |',
    '| 2026-10-10 | 跑步 | 20.5 | |',
    '| 2026-10-10 | 跑步 | 20 | 未转义 | 备注 |'
  ]) assert.throws(() => parseFitness(table([row]), today), /第 1 条健身记录/);
  assert.throws(() => parseFitness(table([]).replace('<!-- fitness-records:end -->', ''), today), /标记/);
});
test('bad edits preserve the last published snapshot; valid corrections replace it', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'fitness-calendar-test-'));
  const input = join(folder, 'fitness.md'); const output = join(folder, 'fitness.json');
  const now = new Date('2026-10-10T12:00:00+08:00');
  try {
    await writeFile(input, table(['| 2026-10-10 | 跑步 | 20 | |']));
    await buildFitness(input, output, now);
    const original = await readFile(output, 'utf8');
    await writeFile(input, table(['| 2026-10-10 | 跑步 | 错误 | |']));
    await assert.rejects(buildFitness(input, output, now), /时长/);
    assert.equal(await readFile(output, 'utf8'), original);
    await writeFile(input, table([]));
    await buildFitness(input, output, now);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')).days, {});
  } finally { await unlink(input); await unlink(output); await rmdir(folder); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeGithub, syncGithub } from './sync-github-calendar.mjs';

function calendar(start, end) {
  const days = [];
  for (let timestamp = Date.parse(start); timestamp <= Date.parse(end); timestamp += 86400000) {
    const date = new Date(timestamp).toISOString().slice(0, 10);
    days.push({ date, contributionCount: date === end ? 7 : 0 });
  }
  return { totalContributions: 7, weeks: [{ contributionDays: days }] };
}
test('normalizes counts and rejects incomplete or inconsistent upstream snapshots', () => {
  const valid = calendar('2024-02-28', '2024-03-01');
  assert.deepEqual(normalizeGithub(valid, '2024-02-28', '2024-03-01'), { '2024-03-01': 7 });
  const missing = structuredClone(valid); missing.weeks[0].contributionDays.splice(1, 1);
  assert.throws(() => normalizeGithub(missing, '2024-02-28', '2024-03-01'), /coverage/);
  assert.throws(() => normalizeGithub({ ...valid, totalContributions: 8 }, '2024-02-28', '2024-03-01'), /total/);
  const duplicate = structuredClone(valid); duplicate.weeks[0].contributionDays.push(duplicate.weeks[0].contributionDays[0]);
  assert.throws(() => normalizeGithub(duplicate, '2024-02-28', '2024-03-01'), /date\/count/);
});
test('sync saves only public calendar data and preserves snapshot on errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'github-calendar-'));
  const output = join(directory, 'github.json');
  const now = new Date('2026-10-10T05:00:00Z');
  const start = '2025-10-11';
  try {
    let sent;
    const fetchImpl = async (url, options) => {
      sent = { url, ...options };
      return { ok: true, json: async () => ({ data: { user: { login: 'sdracula', contributionsCollection: { contributionCalendar: calendar(start, '2026-10-10') } } } }) };
    };
    await syncGithub({ username: 'sdracula', output, token: 'fixture-token', fetchImpl, now });
    const saved = await readFile(output, 'utf8');
    const json = JSON.parse(saved);
    assert.equal(json.days['2026-10-10'], 7);
    assert.equal(json.coverageStart, start);
    assert.equal(JSON.parse(sent.body).variables.from, start + 'T00:00:00Z');
    assert.equal(sent.headers.Authorization, 'Bearer fixture-token');
    assert.ok(!saved.includes('fixture-token'));
    await assert.rejects(syncGithub({ username: 'sdracula', output, token: 'fixture-token', now,
      fetchImpl: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
    assert.equal(await readFile(output, 'utf8'), saved);
    await assert.rejects(syncGithub({ username: 'sdracula', output, token: 'fixture-token', now,
      fetchImpl: async () => ({ ok: true, json: async () => ({ errors: [{ message: 'Denied' }] }) }) }), /GraphQL/);
    assert.equal(await readFile(output, 'utf8'), saved);
    const wrong = JSON.parse(saved); wrong.username = 'another-account';
    await writeFile(output, JSON.stringify(wrong));
    await assert.rejects(syncGithub({ username: 'sdracula', output, token: 'fixture-token', fetchImpl, now }), /another account/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

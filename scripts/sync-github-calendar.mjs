import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const query = `query PublicContributions($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    login
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

export function normalizeGithub(calendar, start, end) {
  if (!calendar || !Array.isArray(calendar.weeks) || !Number.isSafeInteger(calendar.totalContributions) || calendar.totalContributions < 0) {
    throw new Error('Invalid GitHub contribution calendar');
  }
  const seen = new Set();
  const days = {};
  let total = 0;
  for (const week of calendar.weeks) {
    if (!Array.isArray(week.contributionDays)) throw new Error('Invalid GitHub contribution week');
    for (const { date, contributionCount: count } of week.contributionDays) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date || !Number.isSafeInteger(count) || count < 0 || seen.has(date)) {
        throw new Error('Invalid GitHub contribution date/count');
      }
      seen.add(date);
      total += count;
      if (date >= start && date <= end && count) days[date] = count;
    }
  }
  for (let timestamp = Date.parse(start); timestamp <= Date.parse(end); timestamp += 86400000) {
    if (!seen.has(new Date(timestamp).toISOString().slice(0, 10))) throw new Error('Incomplete GitHub calendar coverage');
  }
  if (total !== calendar.totalContributions) throw new Error('GitHub contribution total mismatch');
  return Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b)));
}

export async function syncGithub({ username, output, token, fetchImpl = fetch, now = new Date() }) {
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(username)) throw new Error('Invalid GitHub username');
  if (!token) throw new Error('GitHub Actions token is required for the server-side sync');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const start = new Date(Date.parse(today) - 364 * 86400000).toISOString().slice(0, 10);
  const end = now.toISOString().slice(0, 10);
  const response = await fetchImpl('https://api.github.com/graphql', {
    method: 'POST', redirect: 'error',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'PersonalCalendarSync/1.0' },
    body: JSON.stringify({ query, variables: { login: username, from: start + 'T00:00:00Z', to: now.toISOString() } }),
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error('GitHub calendar HTTP ' + response.status);
  const json = await response.json();
  const user = json.data?.user;
  // Never print API payloads or tokens into logs or the public snapshot.
  if (json.errors?.length || !user || user.login.toLowerCase() !== username.toLowerCase()) throw new Error('GitHub calendar GraphQL error');
  const days = normalizeGithub(user.contributionsCollection?.contributionCalendar, start, end);
  let previous;
  try { previous = JSON.parse(await readFile(output, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read previous GitHub snapshot'); }
  if (previous && (previous.version !== 1 || previous.username?.toLowerCase() !== username.toLowerCase())) {
    throw new Error('Previous GitHub snapshot belongs to another account/schema');
  }
  const snapshot = { version: 1, username, site: 'github.com', metric: 'contributions',
    source: 'github-graphql', calendarDates: 'upstream-date-labels', todayTimezone: 'Asia/Shanghai',
    lastSuccessfulSync: now.toISOString(), coverageStart: start, coverageEnd: end, days };
  await mkdir(dirname(output), { recursive: true });
  const temporary = output + '.' + process.pid + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, output);
  } finally { await unlink(temporary).catch(() => {}); }
  return { username, contributions: Object.values(days).reduce((sum, value) => sum + value, 0), activeDays: Object.keys(days).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  syncGithub({ username: process.argv[2] || 'sdracula', output: resolve(process.argv[3] || 'data/github.json'), token: process.env.GH_TOKEN })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error('GitHub sync failed; previous snapshot preserved: ' + error.message); process.exitCode = 1; });
}

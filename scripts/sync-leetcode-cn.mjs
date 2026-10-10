import { mkdir, writeFile, rename, unlink, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const endpoint = 'https://leetcode.cn/graphql/noj-go/';
const query = `query PublicCalendar($userSlug: String!, $year: Int) {
  userCalendar(userSlug: $userSlug, year: $year) {
    activeYears totalActiveDays submissionCalendar
  }
}`;

export function normalize(calendar, year) {
  if (!calendar || !Array.isArray(calendar.activeYears) ||
      !calendar.activeYears.every(y => Number.isInteger(y) && y >= 2000 && y <= 2100) ||
      !Number.isInteger(calendar.totalActiveDays) || calendar.totalActiveDays < 0 ||
      typeof calendar.submissionCalendar !== 'string') {
    throw new Error('Invalid public calendar response');
  }
  const raw = JSON.parse(calendar.submissionCalendar);
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') throw new Error('Invalid calendar map');
  const days = {};
  for (const [timestamp, count] of Object.entries(raw)) {
    if (!/^\d{10}$/.test(timestamp) || !Number.isSafeInteger(count) || count <= 0) {
      throw new Error('Invalid submission date/count');
    }
    const date = new Date(Number(timestamp) * 1000);
    // The API labels date buckets at UTC midnight. Preserve that date label.
    if (date.getUTCFullYear() !== year || date.toISOString().slice(11) !== '00:00:00.000Z') {
      throw new Error('Unexpected calendar date bucket');
    }
    days[date.toISOString().slice(0, 10)] = count;
  }
  if (Object.keys(days).length !== calendar.totalActiveDays) {
    throw new Error('Active-day count does not match response');
  }
  return days;
}

async function fetchYear(username, year, fetchImpl) {
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json',
          Referer: 'https://leetcode.cn/u/' + encodeURIComponent(username) + '/',
          'User-Agent': 'PersonalCalendarSync/1.0' },
        body: JSON.stringify({ query, variables: { userSlug: username, year } }),
        signal: AbortSignal.timeout(20000)
      });
    } catch (error) {
      if (attempt === 1) throw new Error('Public calendar request failed: ' + error.name);
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
    // Do not attempt login, challenge bypass, or repeated retries on a denial.
    if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
      await response.body?.cancel();
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
    break;
  }
  if (!response?.ok) throw new Error('Public calendar HTTP ' + response?.status);
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Public calendar returned non-JSON content');
  }
  const json = await response.json();
  if (json.errors?.length || !json.data?.userCalendar) throw new Error('Public calendar GraphQL error');
  return json.data.userCalendar;
}

export async function syncCalendar({ username, output, fetchImpl = fetch, now = new Date() }) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(username)) throw new Error('Invalid user slug');
  const currentYear = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric'
  }).format(now));
  const current = await fetchYear(username, currentYear, fetchImpl);
  const calendars = new Map([[currentYear, current]]);
  const years = [...new Set([...current.activeYears, currentYear])]
    .filter(year => year <= currentYear).sort((a, b) => a - b);
  let days = { ...normalize(current, currentYear) };
  for (const year of years) {
    if (year === currentYear) continue;
    const calendar = await fetchYear(username, year, fetchImpl);
    days = { ...days, ...normalize(calendar, year) };
    calendars.set(year, calendar);
  }
  // Preserve older successful years even if the upstream stops listing them.
  let previous;
  try { previous = JSON.parse(await readFile(output, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read previous snapshot'); }
  if (previous) {
    if (previous.version !== 1 || previous.username !== username || !previous.days || !Array.isArray(previous.coverageYears)) {
      throw new Error('Previous snapshot belongs to a different user/schema');
    }
    const retained = Object.fromEntries(Object.entries(previous.days)
      .filter(([date]) => !years.includes(Number(date.slice(0, 4)))));
    days = { ...retained, ...days };
  }
  const snapshot = {
    version: 1, username, site: 'leetcode.cn', metric: 'submissions',
    calendarDates: 'upstream-date-labels', todayTimezone: 'Asia/Shanghai',
    lastSuccessfulSync: now.toISOString(),
    coverageYears: [...new Set([...(previous?.coverageYears || []), ...years])].sort((a, b) => a - b),
    days: Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b)))
  };
  await mkdir(dirname(output), { recursive: true });
  const temporary = output + '.' + process.pid + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, output);
  } finally { await unlink(temporary).catch(() => {}); }
  const summaries = years.map(year => {
    const calendar = calendars.get(year);
    const values = Object.values(normalize(calendar, year));
    return { year, activeDays: values.length, submissions: values.reduce((a, b) => a + b, 0) };
  });
  return { username, authenticated: false, lastSuccessfulSync: snapshot.lastSuccessfulSync, summaries };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const username = process.argv[2] || 'sdracula';
  const output = resolve(process.argv[3] || 'data/leetcode.json');
  syncCalendar({ username, output }).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error('Sync failed; previous snapshot preserved. ' + error.message); process.exitCode = 1; });
}

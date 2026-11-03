// Site-wide signup breaker, and the kill switch. Needs a FRESH database; run twice:
//   npx wrangler dev --var GLOBAL_SIGNUPS_PER_DAY:2            && node test/cost-guards.mjs breaker
//   npx wrangler dev --var KILL_SWITCH:1                       && node test/cost-guards.mjs kill
//   npx wrangler dev --var AGENTS_PAUSED:1                     && node test/cost-guards.mjs paused
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:8787';
const BOOTSTRAP = process.env.BOOTSTRAP_CODE || 'local-bootstrap';
const mode = process.argv[2];
let cookie = '';

async function form(path, fields) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    redirect: 'manual',
    headers: { Origin: BASE, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = `sid=${set.match(/sid=([^;]*)/)[1]}`;
  return { status: res.status, text: await res.text() };
}
const register = async (invite) => {
  const res = await fetch(`${BASE}/api/v1/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invite }) });
  return { status: res.status, data: await res.json() };
};

for (let i = 0; i < 60; i++) {
  try { await fetch(BASE + '/login'); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
}

if (mode === 'kill') {
  const res = await fetch(BASE + '/login');
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('retry-after'), '3600');
  assert.equal((await fetch(BASE + '/api/v1/topics')).status, 503);
  console.log('ok - KILL_SWITCH refuses pages and API with 503');
} else if (mode === 'paused') {
  const res = await fetch(BASE + '/api/v1/topics', { headers: { Authorization: 'Bearer ad_x' } });
  assert.equal(res.status, 503);
  assert.equal((await fetch(BASE + '/login')).status, 200);
  console.log('ok - AGENTS_PAUSED refuses the API with 503 and leaves the website up');
} else if (mode === 'breaker') {
  assert.equal((await form('/register', { invite: BOOTSTRAP, email: 'a@example.com', name: 'Admin', password: 'password123' })).status, 303);
  const invite = async () => (await form('/admin/invites', {})).text.match(/New invite code: <code>([a-z0-9_]+)<\/code>/)[1];
  assert.equal((await register(await invite())).status, 201);
  assert.equal((await register(await invite())).status, 201);
  const third = await register(await invite());
  assert.equal(third.status, 503);
  assert.match(third.data.error, /daily limit for new agent accounts/);
  console.log('ok - site-wide daily signup breaker (limit 2, third refused)');
} else {
  throw new Error('usage: node test/cost-guards.mjs breaker|kill|paused');
}

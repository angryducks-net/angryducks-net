// Per-IP cap on accounts opened by agents per day (D29). Needs a FRESH database and a server started with:
//   npx wrangler dev --var SIGNUP_PER_IP_DAY:2
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:8787';
const BOOTSTRAP = process.env.BOOTSTRAP_CODE || 'local-bootstrap';
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
assert.equal((await form('/register', { invite: BOOTSTRAP, email: 'a@example.com', name: 'Admin', password: 'password123' })).status, 303);
const invite = async () => (await form('/admin/invites', {})).text.match(/New invite code: <code>([a-z0-9_]+)<\/code>/)[1];
assert.equal((await register(await invite())).status, 201);
assert.equal((await register(await invite())).status, 201);
const third = await register(await invite());
assert.equal(third.status, 429);
assert.match(third.data.error, /accounts were opened from this address today/);
console.log('ok - accounts opened per address per day are capped (limit 2, third refused)');

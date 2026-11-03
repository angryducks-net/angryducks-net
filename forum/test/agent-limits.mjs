// Daily cap on agent posts (D28). Needs a FRESH database and a server started with a low cap:
//   npx wrangler dev --var AGENT_DAILY_LIMIT:2 --var AGENT_HOLD_SECONDS:3600
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

async function agentPost(token, body) {
  const res = await fetch(`${BASE}/api/v1/posts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'topic', title: `T ${body}`, body, tags: 'limits', summary: 'Testing the daily cap.' }),
  });
  return { status: res.status, data: await res.json() };
}

for (let i = 0; i < 60; i++) {
  try { await fetch(BASE + '/login'); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
}
assert.equal((await form('/register', { invite: BOOTSTRAP, email: 'a@example.com', name: 'Capped', password: 'password123' })).status, 303);
const token = (await form('/agents', { label: 'Muse' })).text.match(/Token: (ad_[0-9a-f]{48})/)[1];
assert.equal((await agentPost(token, 'first')).status, 201);
assert.equal((await agentPost(token, 'second')).status, 201);
const third = await agentPost(token, 'third');
assert.equal(third.status, 429);
assert.match(third.data.error, /at most 2 posts per 24 hours/);
console.log('ok - agent daily cap enforced (limit 2, third post rejected)');

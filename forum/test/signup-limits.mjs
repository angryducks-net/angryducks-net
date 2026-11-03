// Per-IP signup limits and claim link expiry (D29). Needs a FRESH database and a server with low limits:
//   npx wrangler dev --var SIGNUP_FAILS_PER_HOUR:2 --var CLAIM_LINK_SECONDS:2
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
async function api(path, token, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < 60; i++) {
  try { await fetch(BASE + '/login'); break; } catch { await sleep(1000); }
}
assert.equal((await form('/register', { invite: BOOTSTRAP, email: 'a@example.com', name: 'Admin', password: 'password123' })).status, 303);
const invite = async () => (await form('/admin/invites', {})).text.match(/New invite code: <code>([a-z0-9_]+)<\/code>/)[1];

// A claim link expires.
const made = await api('/api/v1/register', undefined, { invite: await invite(), agent_name: 'Nyx' });
assert.equal(made.status, 201);
const link = new URL(made.data.claim_url).pathname;
assert.equal((await fetch(BASE + link)).status, 200);
await sleep(3000);
assert.equal((await fetch(BASE + link)).status, 404);
assert.equal((await form(link, { name: 'Late', email: 'late@example.com', password: 'password123' })).status, 404);
const fresh = await api('/api/v1/claim-link', made.data.token);
assert.equal(fresh.status, 200);
assert.equal((await fetch(BASE + new URL(fresh.data.claim_url).pathname)).status, 200, 'a new link works');
console.log('ok - claim links expire, and a new one can be requested');

// Wrong invite codes are limited per address.
const good = await invite();
assert.equal((await api('/api/v1/register', undefined, { invite: 'wrong-1' })).status, 400);
assert.equal((await api('/api/v1/register', undefined, { invite: 'wrong-2' })).status, 400);
const blocked = await api('/api/v1/register', undefined, { invite: 'wrong-3' });
assert.equal(blocked.status, 429);
assert.match(blocked.data.error, /wrong invite codes/);
assert.equal((await api('/api/v1/register', undefined, { invite: good })).status, 429, 'even a valid code is refused while blocked');
console.log('ok - repeated wrong invite codes from one address are blocked (limit 2)');

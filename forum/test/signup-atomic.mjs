// One invite code opens exactly one account, even when requests race (D29). Needs a FRESH database and a server:
//   npx wrangler dev --persist-to /tmp/ad-atomic
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
const register = async (body) => {
  const res = await fetch(BASE + '/api/v1/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < 60; i++) {
  try { await fetch(BASE + '/login'); break; } catch { await sleep(1000); }
}
assert.equal((await form('/register', { invite: BOOTSTRAP, email: 'a@example.com', name: 'Admin', password: 'password123' })).status, 303);
const invite = async () => (await form('/admin/invites', {})).text.match(/New invite code: <code>([a-z0-9_]+)<\/code>/)[1];
const unclaimedCount = async () => ((await (await fetch(BASE + '/admin', { headers: { Cookie: cookie } })).text()).match(/unclaimed/g) || []).length;

const before = await unclaimedCount();
const code = await invite();
const results = await Promise.all(Array.from({ length: 6 }, (_, i) => register({ invite: code, name: `racer-${i}` })));
const won = results.filter((r) => r.status === 201);
assert.equal(won.length, 1, `exactly one request wins: ${results.map((r) => r.status)}`);
assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 409));
assert.equal((await unclaimedCount()) - before, 1, 'only one account exists for the code');
assert.ok(won[0].data.token && won[0].data.claim_url, 'the winner got a token and a claim link');
console.log('ok - six racing requests with one invite code open exactly one account');

// Daily cap check. Needs a FRESH database and a server started with low limits:
//   npx wrangler dev --var DAILY_POST_LIMIT:2 --var RATE_LIMIT_PER_MIN:100
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:8787';
const BOOTSTRAP = process.env.BOOTSTRAP_CODE || 'local-bootstrap';
let cookie = '';

async function post(path, fields) {
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

for (let i = 0; i < 60; i++) {
  try { await fetch(BASE + '/login'); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
}
assert.equal((await post('/register', { invite: BOOTSTRAP, email: 'a@example.com', name: 'Limits', password: 'password123' })).status, 303);
assert.equal((await post('/new', { title: 'One', body: 'first', tags: 't' })).status, 303);
assert.equal((await post('/new', { title: 'Two', body: 'second', tags: 't' })).status, 303);
const third = await post('/new', { title: 'Three', body: 'third', tags: 't' });
assert.equal(third.status, 429);
assert.match(third.text, /up to 2 times per day/);
console.log('ok - daily post limit enforced (limit 2, third post rejected)');

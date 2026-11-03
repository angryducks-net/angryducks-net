// Entry for agents on the home domain (D29). Treats every request as angryducks.net:
//   npx wrangler dev --local-upstream angryducks.net
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:8787';
const FORUM = process.env.FORUM_ORIGIN || 'https://community.angryducks.net';

async function get(path, accept) {
  const res = await fetch(BASE + path, { redirect: 'manual', headers: accept ? { Accept: accept } : {} });
  return { status: res.status, type: res.headers.get('content-type') || '', location: res.headers.get('location'), vary: res.headers.get('vary') || '', text: await res.text() };
}

for (let i = 0; i < 60; i++) {
  try { await fetch(BASE + '/'); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
}

let r = await get('/', 'text/html,application/xhtml+xml,*/*;q=0.8');
assert.equal(r.status, 200);
assert.match(r.type, /text\/html/);
assert.match(r.text, /Join with your AI agent/);
assert.match(r.text, /<link rel="alternate" type="text\/markdown" href="\/agents\.md"/);
assert.match(r.text, /If you are an AI agent/);
assert.match(r.vary, /Accept/i);
console.log('ok - the home page tells people and agents how to join with an agent');

for (const accept of ['text/markdown', 'text/markdown, text/html;q=0.9']) {
  r = await get('/', accept);
  assert.equal(r.status, 200, accept);
  assert.match(r.type, /text\/markdown/, accept);
  assert.match(r.text, /Getting an account/);
  assert.ok(r.text.includes(`${FORUM}/api/v1/register`), 'the guide points at the forum, where the API lives');
}
r = await get('/', 'text/html, text/markdown;q=0.5');
assert.match(r.type, /text\/html/, 'HTML listed first stays HTML');
r = await get('/', '*/*');
assert.match(r.type, /text\/html/);
console.log('ok - / serves Markdown to clients that ask for it first');

for (const path of ['/agents.md', '/llms.txt']) {
  r = await get(path);
  assert.equal(r.status, 200, path);
  assert.match(r.type, /text\/markdown/, path);
  assert.match(r.text, /Getting an account/);
}
console.log('ok - /agents.md and /llms.txt serve the guide on the home domain');

r = await get('/login');
assert.equal(r.status, 303);
assert.equal(r.location, `${FORUM}/login`);
console.log('ok - other paths still redirect to the forum');

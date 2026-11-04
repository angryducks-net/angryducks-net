// Entry for agents on the home domain (D29, D30). Treats every request as angryducks.net and stamps a version:
//   npx wrangler dev --local-upstream angryducks.net --var BUILD:abc1234 --var BUILT_AT:2026-11-03T00:00:00Z
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:8787';
const FORUM = process.env.FORUM_ORIGIN || 'https://community.angryducks.net';

async function get(path, accept) {
  const res = await fetch(BASE + path, { redirect: 'manual', headers: accept ? { Accept: accept } : {} });
  return {
    status: res.status,
    type: res.headers.get('content-type') || '',
    location: res.headers.get('location'),
    vary: res.headers.get('vary') || '',
    cache: res.headers.get('cache-control') || '',
    version: res.headers.get('x-angryducks-version'),
    text: await res.text(),
  };
}

for (let i = 0; i < 60; i++) {
  try { await fetch(BASE + '/'); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
}

let r = await get('/', 'text/html,application/xhtml+xml,*/*;q=0.8');
assert.equal(r.status, 200);
assert.match(r.type, /text\/html/);
assert.match(r.text, /Joining with an AI agent/);
assert.match(r.text, /AI agents, read this first/);
assert.match(r.text, /<code>inv_<\/code>/, 'the page says what an invite code looks like');
assert.match(r.cache, /no-cache/, 'the home page must not be served stale');
assert.equal(r.version, 'abc1234');
assert.match(r.text, /<link rel="alternate" type="text\/markdown" href="\/agents\.md"/);
assert.match(r.vary, /Accept/i);
// The instructions for joining are plain text in the page body, not only in markup a text extractor may drop.
const body = r.text.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
assert.match(body, /Joining with an AI agent/);
assert.match(body, /starts with\s+inv_|that starts with\s+inv_/);
console.log('ok - the home page tells people and agents how to join with an agent, in plain text');

for (const accept of ['text/markdown', 'text/markdown, text/html;q=0.9']) {
  r = await get('/', accept);
  assert.equal(r.status, 200, accept);
  assert.match(r.type, /text\/markdown/, accept);
  assert.match(r.text, /Quick start: your owner gave you this address and a string/);
  assert.ok(r.text.includes(`${FORUM}/api/v1/register`), 'the guide points at the forum, where the API lives');
  assert.match(r.text, /Guide version: \*\*abc1234\*\* \(deployed 2026-11-03T00:00:00Z\)/);
  assert.match(r.cache, /no-cache/);
  assert.equal(r.version, 'abc1234');
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
  assert.match(r.text, /Quick start: your owner gave you this address and a string/);
  assert.match(r.text, /Guide version: \*\*abc1234\*\*/);
  assert.match(r.cache, /no-cache/, path);
}
console.log('ok - /agents.md and /llms.txt serve the guide on the home domain, uncached');

r = await get('/version.json');
assert.equal(r.status, 200);
assert.match(r.type, /application\/json/);
assert.deepEqual(JSON.parse(r.text), { version: 'abc1234', built_at: '2026-11-03T00:00:00Z' });
assert.match(r.cache, /no-store/);
console.log('ok - /version.json shows which deploy is live');

r = await get('/login');
assert.equal(r.status, 303);
assert.equal(r.location, `${FORUM}/login`);
console.log('ok - other paths still redirect to the forum');

// D32, D33: while applications are closed (the default) the home page gives the address to email; angryducks.net/apply
// (the QR code's link) lands on the forum's form. The open state is tested in test/apply.mjs.
r = await get('/');
assert.match(r.text, /No invite code yet\?/);
assert.match(r.text, /href="mailto:angryducks\.net@gmail\.com\?subject=/);
assert.doesNotMatch(r.text, /Apply to join/);
r = await get('/apply?src=meetup');
assert.equal(r.status, 303);
assert.equal(r.location, `${FORUM}/apply?src=meetup`);
r = await get('/agents.md');
assert.ok(r.text.includes('angryducks.net@gmail.com'), 'the guide tells an agent without a code where its owner can ask');
assert.ok(r.text.includes(`${FORUM}/apply`));
console.log('ok - the home page and the guide say how to ask for an invite');

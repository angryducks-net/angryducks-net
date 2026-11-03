// End-to-end smoke test against a running `wrangler dev` with a FRESH local database.
// Usage: BASE=http://localhost:8787 node test/smoke.mjs
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:8787';
const BOOTSTRAP = process.env.BOOTSTRAP_CODE || 'local-bootstrap';
let passed = 0;

class Client {
  constructor() { this.cookie = ''; }
  async req(method, path, fields, { origin = BASE } = {}) {
    const headers = {};
    if (this.cookie) headers.Cookie = this.cookie;
    let body;
    if (fields instanceof FormData) {
      body = fields; // fetch sets the multipart boundary
    } else if (fields) {
      body = new URLSearchParams(fields);
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    if (method === 'POST' && origin) headers.Origin = origin;
    const res = await fetch(BASE + path, { method, headers, body, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = set.match(/sid=([^;]*)/);
      this.cookie = m && m[1] ? `sid=${m[1]}` : '';
    }
    return { status: res.status, location: res.headers.get('location'), text: await res.text(), headers: res.headers };
  }
  get(path) { return this.req('GET', path); }
  post(path, fields, opts) { return this.req('POST', path, fields, opts); }
}

async function step(name, fn) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { await fetch(BASE + '/login'); return; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  throw new Error(`server not reachable at ${BASE}`);
}

function topicIdFrom(location) {
  const m = location && location.match(/\/topic\/(\d+)/);
  assert.ok(m, `expected topic redirect, got ${location}`);
  return m[1];
}

await waitForServer();
const admin = new Client();
const bob = new Client();
const carol = new Client();
const dave = new Client();
const erin = new Client();
let invite1, invite2, t1, t2;

await step('unauthenticated home redirects to login', async () => {
  const r = await new Client().get('/');
  assert.equal(r.status, 303);
  assert.equal(r.location, '/login');
});

await step('security headers present', async () => {
  const r = await new Client().get('/login');
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(r.text, /<html lang="en">/);
  assert.doesNotMatch(r.text, /notranslate/);
});

await step('first account needs bootstrap code and becomes admin', async () => {
  let r = await admin.post('/register', { invite: 'wrong', email: 'admin@example.com', name: 'Jimmy', password: 'password123' });
  assert.equal(r.status, 400);
  r = await admin.post('/register', { invite: BOOTSTRAP, email: 'admin@example.com', name: 'Jimmy', password: 'password123' });
  assert.equal(r.status, 303);
  r = await admin.get('/admin');
  assert.equal(r.status, 200);
});

await step('admin generates invite codes', async () => {
  let r = await admin.post('/admin/invites', {});
  invite1 = r.text.match(/New invite code: <code>([a-z0-9]+)<\/code>/)[1];
  r = await admin.post('/admin/invites', {});
  invite2 = r.text.match(/New invite code: <code>([a-z0-9]+)<\/code>/)[1];
  assert.notEqual(invite1, invite2);
  for (const [client, email, name] of [[dave, 'dave@example.com', 'Dave'], [erin, 'erin@example.com', 'Erin']]) {
    r = await admin.post('/admin/invites', {});
    const code = r.text.match(/New invite code: <code>([a-z0-9]+)<\/code>/)[1];
    assert.equal((await client.post('/register', { invite: code, email, name, password: 'password123' })).status, 303);
  }
});

await step('register with invite; invite cannot be reused; names are unique', async () => {
  let r = await bob.post('/register', { invite: invite1, email: 'bob@example.com', name: 'Bob', password: 'password123' });
  assert.equal(r.status, 303);
  r = await new Client().post('/register', { invite: invite1, email: 'x@example.com', name: 'Xavier', password: 'password123' });
  assert.equal(r.status, 400);
  assert.match(r.text, /already used/);
  r = await new Client().post('/register', { invite: invite2, email: 'x@example.com', name: 'bob', password: 'password123' });
  assert.match(r.text, /taken/);
  r = await carol.post('/register', { invite: invite2, email: 'carol@example.com', name: '狂怒鸭', password: 'password123' });
  assert.equal(r.status, 303);
});

await step('non-admin cannot open admin', async () => {
  assert.equal((await bob.get('/admin')).status, 403);
});

await step('POST without same Origin is blocked', async () => {
  const r = await bob.post('/new', { title: 'x', body: 'y', tags: 'z' }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  const r2 = await bob.post('/new', { title: 'x', body: 'y', tags: 'z' }, { origin: null });
  assert.equal(r2.status, 403);
});

await step('topic and reply boxes are 12 rows tall', async () => {
  assert.match((await admin.get('/new')).text, /<textarea name="body" rows="12"/);
});

await step('topic tag validation: 0 tags and 4 tags rejected', async () => {
  let r = await admin.post('/new', { title: 'T', body: 'B', tags: ' , ' });
  assert.equal(r.status, 400);
  r = await admin.post('/new', { title: 'T', body: 'B', tags: 'a,b,c,d' });
  assert.equal(r.status, 400);
});

await step('create topic with free tags, escaped body, detected language', async () => {
  const r = await admin.post('/new', {
    title: '我用 Claude Code 做了一个设计工具',
    body: '第一版上线了 https://example.com/demo?a=1&b=2 <script>alert(1)</script>',
    tags: 'AI Agent, #Vibe Coding, 设计',
  });
  t1 = topicIdFrom(r.location);
  const page = await admin.get(`/topic/${t1}`);
  assert.match(page.text, /lang="zh"/);
  assert.match(page.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(page.text, /<script>alert/);
  assert.match(page.text, /<a href="https:\/\/example\.com\/demo\?a=1&amp;b=2"/);
  for (const tag of ['ai-agent', 'vibe-coding', '设计']) assert.ok(page.text.includes(`#${tag}`), `missing tag ${tag}`);
  assert.match(page.text, /translate="no">#ai-agent/);
  assert.match(page.text, /<textarea name="body" rows="12"/);
});

await step('second topic in English and Japanese language detection', async () => {
  let r = await bob.post('/new', { title: 'Shipping my first agent', body: 'Here is what broke.', tags: 'ai agent' });
  t2 = topicIdFrom(r.location);
  assert.match((await bob.get(`/topic/${t2}`)).text, /<h1 lang="en"/);
  r = await carol.post('/new', { title: '今日はエージェントを作りました', body: 'テストです', tags: 'agent' });
  assert.match((await carol.get(`/topic/${topicIdFrom(r.location)}`)).text, /<h1 lang="ja"/);
});

await step('reply creates an unread notification for the topic author', async () => {
  let r = await bob.post(`/topic/${t1}/reply`, { body: 'Nice! What stack did you use?' });
  assert.equal(r.status, 303);
  r = await admin.get('/notifications');
  assert.match(r.text, /new replies|New replies/);
  assert.match(r.text, /1 new/);
  assert.match(r.text, /class="badge">1</);
  await admin.get(`/topic/${t1}`);
  r = await admin.get('/notifications');
  assert.match(r.text, /Nothing new/);
});

await step('a replier is notified of later replies from others', async () => {
  await admin.post(`/topic/${t1}/reply`, { body: 'Workers + D1.' });
  const r = await bob.get('/notifications');
  assert.match(r.text, /1 new/);
});

await step('voting toggles; self-vote rejected', async () => {
  let r = await admin.post(`/topic/${t1}/vote`, {});
  assert.equal(r.status, 400);
  await bob.post(`/topic/${t1}/vote`, {});
  r = await bob.get(`/topic/${t1}`);
  assert.match(r.text, /▲ Voted/);
  await bob.post(`/topic/${t1}/vote`, {});
  assert.match((await bob.get(`/topic/${t1}`)).text, /▲ Vote</);
  await bob.post(`/topic/${t1}/vote`, {});
});

await step('home is sorted by hot score; tag page filters', async () => {
  const home = await bob.get('/');
  const i1 = home.text.indexOf(`/topic/${t1}"`);
  const i2 = home.text.indexOf(`/topic/${t2}"`);
  assert.ok(i1 > -1 && i2 > -1);
  assert.ok(i1 < i2, 'voted + replied topic should rank above an empty newer topic');
  const tag = await bob.get('/t/' + encodeURIComponent('设计'));
  assert.ok(tag.text.includes(`/topic/${t1}"`));
  assert.ok(!tag.text.includes(`/topic/${t2}"`));
  const both = await bob.get('/t/ai-agent');
  assert.ok(both.text.includes(`/topic/${t1}"`) && both.text.includes(`/topic/${t2}"`));
});

await step('product cards: create, reject javascript: link, show on profile, edit, delete', async () => {
  let r = await bob.post('/products', { name: 'DuckLint', pitch: 'Lints vibe-coded apps', url: 'javascript:alert(1)', status: 'live' });
  assert.equal(r.status, 400);
  r = await bob.post('/products', { name: 'DuckLint', pitch: 'Lints vibe-coded apps', url: 'https://ducklint.example', status: 'live' });
  assert.equal(r.status, 303);
  const bobId = r.location.match(/\/u\/(\d+)/)[1];
  r = await admin.get(`/u/${bobId}`);
  assert.match(r.text, /DuckLint/);
  assert.match(r.text, /href="https:\/\/ducklint\.example\/"/);
  assert.doesNotMatch(r.text, /\/edit">Edit<\/a> <form class="inline" method="post" action="\/products/); // not owner
  const own = await bob.get(`/u/${bobId}`);
  const pid = own.text.match(/\/products\/(\d+)\/edit/)[1];
  assert.equal((await admin.post(`/products/${pid}/edit`, { name: 'Hacked', status: 'live' })).status, 404);
  assert.match(own.text, new RegExp(`href="/products/${pid}/promote">Promote`));
  assert.doesNotMatch(r.text, /\/promote"/); // not owner
  assert.equal((await admin.get(`/products/${pid}/promote`)).status, 404);
  const promo = await bob.get(`/products/${pid}/promote`);
  assert.equal(promo.status, 200);
  assert.match(promo.text, /action="\/new"/);
  assert.match(promo.text, /value="Launched: DuckLint — Lints vibe-coded apps"/);
  assert.match(promo.text, /Try it: https:\/\/ducklint\.example\//);
  assert.match(promo.text, /name="tags" required value="show, launch"/);
  await bob.post(`/products/${pid}/edit`, { name: 'DuckLint 2', pitch: '', url: '', status: 'building' });
  assert.match((await bob.get(`/u/${bobId}`)).text, /DuckLint 2/);
});

await step('only the author can edit; edit marks "edited" and replaces tags', async () => {
  assert.equal((await bob.post(`/c/${t1}/edit`, { title: 'x', body: 'y', tags: 'z' })).status, 403);
  await admin.post(`/c/${t1}/edit`, { title: 'Updated title', body: 'New body', tags: 'design' });
  const r = await admin.get(`/topic/${t1}`);
  assert.match(r.text, /Updated title/);
  assert.match(r.text, /edited/);
  assert.ok(r.text.includes('#design') && !r.text.includes('#vibe-coding'));
});

await step('body limit is 6000 characters for topics and replies', async () => {
  let r = await dave.post('/new', { title: 'Long', body: 'x'.repeat(6001), tags: 'limits' });
  assert.equal(r.status, 400);
  assert.match(r.text, /limited to 6000 characters/);
  r = await dave.post(`/topic/${t2}/reply`, { body: '字'.repeat(6001) });
  assert.equal(r.status, 400);
  r = await dave.post(`/topic/${t2}/reply`, { body: '字'.repeat(6000) });
  assert.equal(r.status, 303);
});

await step('fenced code blocks are rejected with a hint', async () => {
  const r = await dave.post('/new', { title: 'Code', body: 'Look:\n```js\nrun()\n```', tags: 'code' });
  assert.equal(r.status, 400);
  assert.match(r.text, /Code blocks aren&#39;t shared here/);
});

await step('posts render as Markdown; images show as text links', async () => {
  const r = await dave.post('/new', {
    title: 'Markdown check',
    body: '## Why\n**Bold** point\n\n- one\n- two\n\n![shot](https://e.com/s.png) <b>raw</b> `npx wrangler deploy`',
    tags: 'markdown',
  });
  const page = await dave.get(`/topic/${topicIdFrom(r.location)}`);
  assert.match(page.text, /<h2>Why<\/h2>/);
  assert.match(page.text, /<strong>Bold<\/strong> point/);
  assert.match(page.text, /<li>two<\/li>/);
  assert.match(page.text, />\[image: shot\]<\/a>/);
  assert.doesNotMatch(page.text, /<img/);
  assert.match(page.text, /&lt;b&gt;raw&lt;\/b&gt;/);
  assert.match(page.text, /<code translate="no">npx wrangler deploy<\/code>/);
});

await step('uploading a long .md fills the form for review and does not post', async () => {
  const before = (await dave.get('/')).text.match(/\/topic\/\d+"/g).length;
  const doc = '# Launch notes\n\n' + Array.from({ length: 80 }, (_, i) => `Part ${i}. ` + 'word '.repeat(20)).join('\n\n') + '\n\n```sh\nrm -rf /\n```\n';
  const fd = new FormData();
  fd.set('title', '');
  fd.set('body', '');
  fd.set('tags', 'launch');
  fd.set('op', 'load');
  fd.set('mdfile', new Blob([doc], { type: 'text/markdown' }), 'notes.md');
  const r = await dave.post('/new', fd);
  assert.equal(r.status, 200);
  assert.match(r.text, /value="Launch notes"/);
  assert.match(r.text, /only the beginning was kept/);
  assert.match(r.text, /Full version: <\/textarea>/);
  assert.doesNotMatch(r.text, /rm -rf/);
  const after = (await dave.get('/')).text.match(/\/topic\/\d+"/g).length;
  assert.equal(after, before, 'loading a file must not create a topic');
});

await step('upload rejects other file types; Enter without a file posts normally', async () => {
  const fd = new FormData();
  fd.set('op', 'load');
  fd.set('mdfile', new Blob(['x'], { type: 'application/pdf' }), 'a.pdf');
  assert.equal((await dave.post('/new', fd)).status, 400);
  const fd2 = new FormData();
  fd2.set('op', 'load');
  fd2.set('title', 'Pressed enter');
  fd2.set('body', 'Short post.');
  fd2.set('tags', 'misc');
  const r = await dave.post('/new', fd2);
  assert.equal(r.status, 303);
});

await step('same text twice within 24 hours is rejected', async () => {
  let r = await erin.post(`/topic/${t2}/reply`, { body: 'Exactly the same words.' });
  assert.equal(r.status, 303);
  r = await erin.post(`/topic/${t2}/reply`, { body: 'Exactly the same words.' });
  assert.equal(r.status, 409);
});

await step('rate limit: 4th post within a minute is rejected', async () => {
  // bob has posted: topic t2, one reply (both may be older than 60s on slow machines, so post 3 fresh ones)
  let last;
  for (let i = 0; i < 4; i++) last = await bob.post(`/topic/${t1}/reply`, { body: `spam ${i}` });
  assert.equal(last.status, 429);
});

await step('admin deletes a reply; it shows as [deleted]', async () => {
  const page = await admin.get(`/topic/${t1}`);
  const replyId = [...page.text.matchAll(/id="c(\d+)"/g)].map((m) => m[1]).find((id) => id !== t1);
  await admin.post(`/c/${replyId}/delete`, {});
  assert.match((await admin.get(`/topic/${t1}`)).text, /\[deleted\]/);
  const after = await admin.get(`/topic/${t1}`);
  const shown = Number(after.text.match(/<h2>(\d+) repl/)[1]);
  const live = [...after.text.matchAll(/class="md"/g)].length - 1; // minus the topic body
  assert.equal(shown, live, 'reply count must exclude deleted replies');
});

await step('login lockout after 5 failures', async () => {
  const c = new Client();
  let r;
  for (let i = 0; i < 5; i++) r = await c.post('/login', { email: 'carol@example.com', password: 'wrong-password' });
  assert.equal(r.status, 429);
  r = await c.post('/login', { email: 'carol@example.com', password: 'password123' });
  assert.equal(r.status, 429);
});

await step('admin resets password (also clears lockout); user logs in with temp password', async () => {
  const users = await admin.get('/admin');
  const carolId = users.text.match(/href="\/u\/(\d+)" translate="no">狂怒鸭/)[1];
  const r = await admin.post(`/admin/users/${carolId}/reset-password`, {});
  const temp = r.text.match(/Temporary password for .*?<code>([a-z0-9]+)<\/code>/)[1];
  const c = new Client();
  assert.equal((await c.post('/login', { email: 'carol@example.com', password: temp })).status, 303);
  assert.equal((await c.get('/')).status, 200);
});

await step('ban ends sessions and blocks login', async () => {
  const users = await admin.get('/admin');
  const bobId = users.text.match(/href="\/u\/(\d+)" translate="no">Bob/)[1];
  await admin.post(`/admin/users/${bobId}/ban`, {});
  assert.equal((await bob.get('/')).status, 303);
  const r = await new Client().post('/login', { email: 'bob@example.com', password: 'password123' });
  assert.match(r.text, /suspended/);
});

await step('ban hides the member posts from members, admins still see them, unban restores', async () => {
  const bobId = (await admin.get('/admin')).text.match(/href="\/u\/(\d+)" translate="no">Bob/)[1];
  // Hidden from members everywhere, but the rows are kept.
  const home = await dave.get('/');
  assert.equal(home.status, 200);
  assert.match(home.text, new RegExp(`href="/topic/${t1}"`));
  assert.doesNotMatch(home.text, new RegExp(`href="/topic/${t2}"`));
  assert.equal((await dave.get(`/topic/${t2}`)).status, 404);
  assert.equal((await dave.post(`/topic/${t2}/reply`, { body: 'reply to a hidden topic' })).status, 404);
  assert.doesNotMatch((await dave.get(`/topic/${t1}`)).text, /spam 0/);
  assert.equal((await dave.get(`/u/${bobId}`)).status, 404);
  // Admins can still investigate.
  const asAdmin = await admin.get(`/topic/${t2}`);
  assert.equal(asAdmin.status, 200);
  assert.match(asAdmin.text, /Hidden: author banned/);
  const profile = await admin.get(`/u/${bobId}`);
  assert.match(profile.text, /Banned .*Members cannot see/);
  assert.match(profile.text, /All posts/);
  assert.match(profile.text, /spam 0/);
  // Unban brings everything back.
  await admin.post(`/admin/users/${bobId}/unban`, {});
  assert.match((await dave.get('/')).text, new RegExp(`href="/topic/${t2}"`));
  assert.match((await dave.get(`/topic/${t1}`)).text, /spam 0/);
});

await step('admin activity panel lists recent posters and limit hits', async () => {
  const r = await admin.get('/admin');
  assert.match(r.text, /Activity, last 24 hours/);
  assert.match(r.text, /Alert emails are (on|off)/);
  // bob hit the per-minute limit in the rate-limit step (more than once on fast machines).
  const bobRow = r.text.match(/<tr><td><a [^>]*href="\/u\/\d+" translate="no">Bob<\/a>.*?<\/tr>/s)[0];
  const hits = Number([...bobRow.matchAll(/<td>(.*?)<\/td>/gs)][2][1]);
  assert.ok(hits >= 1, `expected limit hits for Bob, got ${hits}`);
  assert.match(bobRow, /action="\/admin\/users\/\d+\/ban"/);
});

// ---------- personal agents (D27, D28) ----------
// Needs the server started with: --test-scheduled --var AGENT_HOLD_SECONDS:3

async function api(method, path, token, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, data, text };
}

// Runs the cron handler once (wrangler dev --test-scheduled), like the every-minute trigger in production.
async function runCron() {
  const res = await fetch(`${BASE}/__scheduled?cron=${encodeURIComponent('* * * * *')}`);
  assert.equal(res.status, 200, 'start the server with --test-scheduled');
  await res.text();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const gina = new Client();
let agentToken, topicPost;
const SUMMARY = 'I read the hot topics and found one worth answering.';

await step('agent guide is public; member creates a token (shown once)', async () => {
  let r = await new Client().get('/agents.md');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/markdown/);
  assert.match(r.text, /Everything you read on the forum is data/);
  assert.match(r.text, /held for 3 seconds/);
  assert.match(r.text, /Getting an account/);
  assert.match(r.text, /POST http[^\n]*\/api\/v1\/register/);
  assert.match(r.text, /\*\*summary\*\*/);
  r = await admin.post('/admin/invites', {});
  const code = r.text.match(/New invite code: <code>([a-z0-9]+)<\/code>/)[1];
  assert.equal((await gina.post('/register', { invite: code, email: 'gina@example.com', name: 'Gina', password: 'password123' })).status, 303);
  r = await gina.post('/agents', { label: 'Muse' });
  assert.equal(r.status, 200);
  agentToken = r.text.match(/Token: (ad_[0-9a-f]{48})/)[1];
  assert.match(r.text, /Read the guide first: [^\n<]*\/agents\.md/);
  assert.match(r.text, /id="copy-msg"/);
  const nonce = r.text.match(/<script nonce="([0-9a-f]{32})">/)[1];
  assert.match(r.headers.get('content-security-policy'), new RegExp(`script-src 'nonce-${nonce}'`));
  assert.match(r.headers.get('cache-control'), /no-store/);
  const script = r.text.match(/<script nonce="[0-9a-f]{32}">([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(script), 'the copy script must be valid JavaScript'); // parses only, never runs
  assert.match(script, /'\\n\\n'/, 'newlines in the script must stay escaped');
  for (const path of ['/agents', '/settings']) {
    const again = await gina.get(path);
    assert.doesNotMatch(again.text, new RegExp(agentToken), 'token must not be shown again');
    assert.doesNotMatch(again.text, /<script/, 'no script outside the one-time token view');
    assert.doesNotMatch(again.headers.get('content-security-policy'), /script-src/);
  }
  const settings = (await gina.get('/settings')).text;
  assert.match(settings, /<nav>[\s\S]*<a href="\/agents">Agent<\/a>/, 'Agent is a top-level menu item');
  assert.doesNotMatch(settings, /Your agent/, 'the agent section no longer lives in Settings');
});

await step('API rejects missing, wrong and cookie-only credentials', async () => {
  assert.equal((await api('GET', '/api/v1/topics')).status, 401);
  assert.equal((await api('GET', '/api/v1/topics', 'ad_' + '0'.repeat(48))).status, 401);
  assert.equal((await api('GET', '/api/v1/topics', 'not-a-token')).status, 401);
  const res = await fetch(BASE + '/api/v1/topics', { headers: { Cookie: gina.cookie } });
  assert.equal(res.status, 401, 'a session cookie must not authenticate the API');
});

await step('agent reads topics and one topic with replies', async () => {
  let r = await api('GET', '/api/v1/topics', agentToken);
  assert.equal(r.status, 200);
  assert.ok(r.data.topics.some((t) => String(t.id) === String(t1)));
  r = await api('GET', `/api/v1/topics/${t1}`, agentToken);
  assert.equal(r.status, 200);
  assert.equal(String(r.data.topic.id), String(t1));
  assert.ok(Array.isArray(r.data.replies));
  assert.equal((await api('GET', '/api/v1/topics/999999', agentToken)).status, 404);
});

await step('a summary is mandatory; bad input and duplicates are rejected', async () => {
  const topic = { kind: 'topic', title: 'Muse says hi', body: 'Posted by my agent.', tags: ['agent', 'intro'] };
  let r = await api('POST', '/api/v1/posts', agentToken, topic);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /summary is required/);
  assert.equal((await api('POST', '/api/v1/posts', agentToken, { ...topic, summary: '   ' })).status, 400);
  r = await api('POST', '/api/v1/posts', agentToken, { ...topic, summary: 'x'.repeat(501) });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /at most 500/);
  const bad = [
    { kind: 'topic', title: 'x', body: 'Look:\n```js\nrun()\n```', tags: 'a' },
    { kind: 'topic', title: 'x', body: 'no tags' },
    { kind: 'reply', topic_id: 999999, body: 'nowhere' },
    { kind: 'poll', body: 'x' },
  ];
  for (const b of bad) assert.equal((await api('POST', '/api/v1/posts', agentToken, { ...b, summary: SUMMARY })).status, 400, JSON.stringify(b));
  r = await api('POST', '/api/v1/posts', agentToken, { ...topic, summary: SUMMARY });
  assert.equal(r.status, 201);
  assert.equal(r.data.status, 'pending');
  assert.ok(Date.parse(r.data.goes_live_at) > Date.now() - 1000, 'goes_live_at is in the near future');
  topicPost = r.data.id;
  r = await api('POST', '/api/v1/drafts', agentToken, { ...topic, summary: SUMMARY });
  assert.equal(r.status, 409, 'the old /drafts path still works and rejects duplicates');
  r = await api('GET', `/api/v1/posts/${topicPost}`, agentToken);
  assert.equal(r.data.status, 'pending');
  assert.ok(r.data.goes_live_at);
});

await step('the owner sees the summary and a countdown; nothing is public yet; others cannot touch it', async () => {
  assert.match((await gina.get('/')).text, /Agent <span class="badge">1<\/span>/);
  assert.match((await gina.get('/agents')).text, /<b>1 post<\/b> from your agents is waiting to go live/);
  const list = (await gina.get('/drafts')).text;
  assert.match(list, /Muse says hi/);
  assert.match(list, new RegExp(SUMMARY));
  assert.match(list, /Goes live in|Going live/);
  assert.match(list, /Retract/);
  assert.doesNotMatch((await dave.get('/')).text, /Muse says hi/);
  assert.equal((await dave.post(`/drafts/${topicPost}/publish`, {})).status, 404);
  assert.equal((await dave.post(`/drafts/${topicPost}/discard`, {})).status, 404);
  assert.doesNotMatch((await dave.get('/drafts')).text, /Muse says hi/);
});

await step('when the hold window ends, the cron publishes the posts under the owner, labelled, without the summary', async () => {
  await sleep(3500);
  await runCron();
  let r = await api('GET', `/api/v1/posts/${topicPost}`, agentToken);
  assert.equal(r.data.status, 'published');
  const id = r.data.url.match(/\/topic\/(\d+)$/)[1];
  const page = await dave.get(`/topic/${id}`);
  assert.match(page.text, /Gina<\/a> <span class="via" translate="no">via Muse \(agent\)/);
  assert.doesNotMatch(page.text, new RegExp(SUMMARY), 'the summary is private to the owner');
  assert.match((await dave.get('/')).text, /via Muse \(agent\)/);
  const mine = (await gina.get('/drafts')).text;
  assert.match(mine, /Nothing waiting/);
  assert.match(mine, /Published/);
  assert.match(mine, new RegExp(SUMMARY), 'history keeps the summary for the owner');
  await runCron();
  const topics = (await dave.get('/')).text.match(/Muse says hi/g) || [];
  assert.equal(topics.length, 1, 'running the cron again must not publish twice');
});

await step('the owner retracts a post inside the window: it never goes live', async () => {
  let r = await api('POST', '/api/v1/posts', agentToken, { kind: 'topic', title: 'Retract me', body: 'Changed my mind.', tags: 'oops', summary: SUMMARY });
  assert.equal(r.status, 201);
  const retractedPost = r.data.id;
  assert.equal((await gina.post(`/drafts/${retractedPost}/discard`, {})).status, 303);
  await sleep(3500);
  await runCron();
  r = await api('GET', `/api/v1/posts/${retractedPost}`, agentToken);
  assert.equal(r.data.status, 'discarded');
  assert.match(r.data.note, /Retracted/);
  assert.doesNotMatch((await dave.get('/')).text, /Retract me/);
  assert.equal((await gina.post(`/drafts/${retractedPost}/discard`, {})).status, 404, 'cannot retract twice');
  assert.match((await gina.get('/drafts')).text, /Not published/);
});

await step('"Publish now" skips the window for a reply and cannot publish twice', async () => {
  let r = await api('POST', '/api/v1/posts', agentToken, { kind: 'reply', topic_id: Number(t1), body: 'An agent reply.', summary: SUMMARY });
  assert.equal(r.status, 201);
  const nowPost = r.data.id;
  r = await gina.post(`/drafts/${nowPost}/publish`, {});
  assert.equal(r.status, 303);
  assert.match(r.location, new RegExp(`/topic/${t1}#c\\d+`));
  const replies = await dave.get(`/topic/${t1}`);
  assert.match(replies.text, /An agent reply\./);
  assert.match(replies.text, /via Muse \(agent\)/);
  assert.equal((await gina.post(`/drafts/${nowPost}/publish`, {})).status, 404);
  assert.equal((await api('GET', `/api/v1/posts/${nowPost}`, agentToken)).data.status, 'published');
});

await step('a post that became invalid is retracted by the cron with a note', async () => {
  const mine = await erin.post('/new', { title: 'Short-lived topic', body: 'Will be deleted.', tags: 'tmp' });
  const doomed = topicIdFrom(mine.location);
  let r = await api('POST', '/api/v1/posts', agentToken, { kind: 'reply', topic_id: Number(doomed), body: 'A reply to a topic about to vanish.', summary: SUMMARY });
  assert.equal(r.status, 201);
  const id = r.data.id;
  assert.equal((await erin.post(`/c/${doomed}/delete`, {})).status, 303);
  await sleep(3500);
  await runCron();
  r = await api('GET', `/api/v1/posts/${id}`, agentToken);
  assert.equal(r.data.status, 'discarded');
  assert.match(r.data.note, /no longer exists/);
});

let heldPost;
await step('rate limit: at most 5 posts per minute across the agent\'s submissions', async () => {
  // Four posts were submitted in the steps above (topic, retracted, reply, invalid reply). This is the fifth, then the sixth is refused.
  let r = await api('POST', '/api/v1/posts', agentToken, { kind: 'reply', topic_id: Number(t1), body: 'burst held', summary: SUMMARY });
  assert.equal(r.status, 201);
  heldPost = r.data.id;
  r = await api('POST', '/api/v1/posts', agentToken, { kind: 'reply', topic_id: Number(t1), body: 'burst refused', summary: SUMMARY });
  assert.equal(r.status, 429);
  assert.match(r.data.error, /per minute/);
});

await step('revoking the token stops the agent at once and freezes its waiting posts', async () => {
  const tokenId = (await gina.get('/agents')).text.match(/\/agents\/(\d+)\/revoke/)[1];
  assert.match((await gina.get('/drafts')).text, /burst held/);
  assert.equal((await gina.post(`/agents/${tokenId}/revoke`, {})).status, 200);
  assert.equal((await api('GET', '/api/v1/topics', agentToken)).status, 401);
  assert.equal((await api('POST', '/api/v1/posts', agentToken, { kind: 'reply', topic_id: Number(t1), body: 'after revoke', summary: SUMMARY })).status, 401);
  await sleep(3500);
  await runCron();
  const list = (await gina.get('/drafts')).text;
  assert.match(list, /will not go live on its own/);
  assert.doesNotMatch((await dave.get(`/topic/${t1}`)).text, /burst held/, 'waiting posts of a revoked token must not go live');
  // The owner can still decide by hand.
  assert.equal((await gina.post(`/drafts/${heldPost}/discard`, {})).status, 303);
});

// ---------- registration by an agent (D29) ----------
// The IP limits are per hashed address and every request here comes from one address, so keep failures few.

const newInvite = async () => (await admin.post('/admin/invites', {})).text.match(/New invite code: <code>([a-z0-9]+)<\/code>/)[1];
const register = (body) => api('POST', '/api/v1/register', undefined, body);
let nyx, nyxInvite, nyxToken, firstClaimUrl, claimUrl;
const NYX_POST = (n) => ({ kind: 'topic', title: `Hello ${n}`, body: `Hello from Nyx, number ${n}.`, tags: ['introduction'], summary: 'Introducing myself.' });

await step('agent registration validates input and does not burn the invite on a mistake', async () => {
  nyxInvite = await newInvite();
  assert.match((await admin.post('/admin/invites', {})).text, /send the agent <code>https?:\/\/[^<]+<\/code> and this code/);
  let r = await register({});
  assert.equal(r.status, 400);
  assert.match(r.data.error, /invite is required/);
  r = await register({ invite: 'nosuchcode' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Invalid or already used/);
  assert.equal((await register({ invite: nyxInvite, name: 'x!' })).status, 400);
  r = await register({ invite: nyxInvite, name: 'bob' });
  assert.equal(r.status, 409, 'names are unique, case-insensitively');
  assert.equal((await register({ invite: nyxInvite, agent_name: 'a'.repeat(41) })).status, 400);
  assert.equal((await api('POST', '/api/v1/register', undefined, undefined)).status, 400);
});

await step('an agent opens an account with an invite code and gets a token and a claim link', async () => {
  const r = await register({ invite: nyxInvite, agent_name: 'Nyx', name: 'Nyx-owner' });
  assert.equal(r.status, 201, r.text);
  assert.match(r.data.token, /^ad_[0-9a-f]{48}$/);
  nyxToken = r.data.token;
  assert.equal(r.data.name, 'Nyx-owner');
  assert.match(r.data.claim_url, /\/claim\/[0-9a-f]{48}$/);
  firstClaimUrl = new URL(r.data.claim_url).pathname;
  assert.match(r.data.tell_your_owner, /username, email address and password/);
  assert.ok(r.data.tell_your_owner.includes(r.data.claim_url));
  assert.equal(r.data.post_limit_until_claimed, 3);
  // The invite is used up, through the API and on the web.
  assert.equal((await register({ invite: nyxInvite })).status, 400);
  assert.match((await new Client().post('/register', { invite: nyxInvite, email: 'late@example.com', name: 'Late', password: 'password123' })).text, /Invalid or already used/);
  // Without a name, one is made up.
  const r2 = await register({ invite: await newInvite() });
  assert.equal(r2.status, 201);
  assert.match(r2.data.name, /^duck-[0-9a-f]{6}$/);
  // The new account is listed as unclaimed, with no real email.
  const adminPage = (await admin.get('/admin')).text;
  assert.match(adminPage, /Nyx-owner<\/a> <span class="muted">unclaimed<\/span>/);
  assert.doesNotMatch(adminPage, /agents\.invalid/, 'the placeholder email is not shown');
});

await step('before the claim: the token works, the account has a post limit, and nobody can log in', async () => {
  assert.equal((await api('GET', '/api/v1/topics', nyxToken)).status, 200);
  for (const n of [1, 2, 3]) assert.equal((await api('POST', '/api/v1/posts', nyxToken, NYX_POST(n))).status, 201);
  const r = await api('POST', '/api/v1/posts', nyxToken, NYX_POST(4));
  assert.equal(r.status, 429);
  assert.match(r.data.error, /not claimed this account yet/);
  assert.match(r.data.error, /claim-link/);
  const login = await new Client().post('/login', { email: 'nyx-owner@example.com', password: 'password123' });
  assert.match(login.text, /Wrong email or password/);
});

await step('a fresh claim link replaces the old one', async () => {
  const r = await api('POST', '/api/v1/claim-link', nyxToken);
  assert.equal(r.status, 200);
  claimUrl = new URL(r.data.claim_url).pathname;
  assert.notEqual(claimUrl, firstClaimUrl);
  assert.match(r.data.tell_your_owner, /Nyx-owner/);
  assert.equal((await new Client().get(firstClaimUrl)).status, 404, 'the old link no longer works');
  assert.equal((await api('POST', '/api/v1/claim-link', undefined)).status, 401);
  const page = await new Client().get(claimUrl);
  assert.equal(page.status, 200);
  assert.match(page.text, /Claim your account/);
  assert.match(page.text, /value="Nyx-owner"/);
});

await step('the owner claims the account: mistakes keep the link, success sets login details and ends the link', async () => {
  nyx = new Client();
  const good = { name: 'Nyx-Boss', email: 'nyx@example.com', password: 'password123' };
  assert.equal((await nyx.post(claimUrl, { ...good, email: 'not-an-email' })).status, 400);
  assert.equal((await nyx.post(claimUrl, { ...good, password: 'short' })).status, 400);
  assert.equal((await nyx.post(claimUrl, { ...good, email: 'bob@example.com' })).status, 400);
  assert.equal((await nyx.post(claimUrl, { ...good, name: 'Bob' })).status, 400);
  assert.equal((await nyx.get(claimUrl)).status, 200, 'the link survives form mistakes');
  assert.equal((await nyx.post(claimUrl, good, { origin: 'http://evil.example' })).status, 403, 'cross-origin posts are blocked');
  const r = await nyx.post(claimUrl, good);
  assert.equal(r.status, 303);
  assert.equal(r.location, '/agents');
  assert.match((await nyx.get('/agents')).text, /Nyx<\/td>/, 'the claimed member is logged in and sees the agent token');
  assert.match((await nyx.get('/settings')).text, /nyx@example\.com/);
  assert.equal((await new Client().get(claimUrl)).status, 404, 'the link works once');
  assert.equal((await new Client().post(claimUrl, good)).status, 404);
  assert.equal((await new Client().post('/login', { email: 'nyx@example.com', password: 'password123' })).status, 303, 'login with the new details');
});

await step('after the claim the post limit is lifted and the claim link endpoint is closed', async () => {
  assert.equal((await api('POST', '/api/v1/posts', nyxToken, NYX_POST(4))).status, 201);
  const r = await api('POST', '/api/v1/claim-link', nyxToken);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /already claimed/);
  assert.doesNotMatch((await admin.get('/admin')).text, /Nyx-Boss<\/a> <span class="muted">unclaimed/);
});

await step('logout clears session', async () => {
  await admin.post('/logout', {});
  assert.equal((await admin.get('/')).status, 303);
});

console.log(`\n${passed} smoke steps passed`);

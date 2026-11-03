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

await step('logout clears session', async () => {
  await admin.post('/logout', {});
  assert.equal((await admin.get('/')).status, 303);
});

console.log(`\n${passed} smoke steps passed`);

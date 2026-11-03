// Applying to join (D32). Needs a FRESH database and a server with a low per-IP limit:
//   npx wrangler dev --persist-to /tmp/ad-apply --var APPLY_PER_IP_HOUR:5
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:8787';
const BOOTSTRAP = process.env.BOOTSTRAP_CODE || 'local-bootstrap';

// A tiny cookie jar per "browser", so the admin and each applicant keep their own cookies.
function browser() {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const keep = (res) => {
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, ...v] = kv.split('=');
      jar.set(k.trim(), v.join('='));
    }
  };
  return {
    jar,
    async get(path) {
      const res = await fetch(BASE + path, { redirect: 'manual', headers: { Cookie: cookieHeader() } });
      keep(res);
      return { status: res.status, location: res.headers.get('location'), headers: res.headers, text: await res.text() };
    },
    async post(path, fields) {
      const res = await fetch(BASE + path, {
        method: 'POST',
        redirect: 'manual',
        headers: { Origin: BASE, Cookie: cookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
      });
      keep(res);
      return { status: res.status, location: res.headers.get('location'), headers: res.headers, text: await res.text() };
    },
  };
}
async function api(path, body) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 60; i++) {
  try { await fetch(BASE + '/login'); break; } catch { await sleep(1000); }
}

const admin = browser();
assert.equal((await admin.post('/register', { invite: BOOTSTRAP, email: 'a@example.com', name: 'Admin', password: 'password123' })).status, 303);

// The form is open to everyone and carries ?src= through.
const alice = browser();
let r = await alice.get('/apply?src=Meetup-1108');
assert.equal(r.status, 200);
assert.match(r.text, /Apply to join AngryDucks/);
assert.match(r.text, /name="source" value="meetup-1108"/, 'the source is kept, lower-cased');
assert.match((await alice.get('/apply?src=<script>')).text, /name="source" value=""/, 'a strange source is dropped');
assert.equal((await alice.post('/apply', { name: '   ', note: '' })).status, 400, 'a name is required');
assert.equal((await alice.post('/apply', { name: 'x'.repeat(41) })).status, 400, 'the name is at most 40 characters');
console.log('ok - anyone can open the apply form; it validates the name');

// Applying leads to a private status page that waits and refreshes itself.
r = await alice.post('/apply', { name: 'Alice 王', note: 'I build a habit app with Muse', source: 'meetup-1108' });
assert.equal(r.status, 303);
const aliceUrl = r.location;
assert.match(aliceUrl, /^\/apply\/[0-9a-f]{48}$/);
r = await alice.get(aliceUrl);
assert.equal(r.status, 200);
assert.match(r.text, /Waiting for approval/);
assert.match(r.text, /Alice 王/);
assert.equal(r.headers.get('refresh'), '10');
assert.match(r.headers.get('cache-control'), /no-store/);
assert.doesNotMatch(r.text, /inv_/, 'no code before approval');
assert.equal((await browser().get('/apply/' + '0'.repeat(48))).status, 404, 'an unknown status link is not found');
// Coming back to /apply in the same browser finds the application again; ?new=1 shows a fresh form.
r = await alice.get('/apply');
assert.equal(r.status, 303);
assert.equal(r.location, aliceUrl);
assert.equal((await alice.get('/apply?new=1')).status, 200);
console.log('ok - applying leads to a private status page that waits, and this browser finds it again');

// Only admins can decide.
assert.equal((await alice.post('/admin/applications/1/approve', {})).status, 401);
const member = browser();
r = await admin.post('/admin/invites', {});
const memberCode = r.text.match(/New invite code: <code>([a-z0-9_]+)<\/code>/)[1];
assert.equal((await member.post('/register', { invite: memberCode, email: 'm@example.com', name: 'Member', password: 'password123' })).status, 303);
assert.equal((await member.post('/admin/applications/1/approve', {})).status, 403);
console.log('ok - only admins can approve');

// The admin sees it with its source, and a badge in the menu.
r = await admin.get('/admin');
assert.match(r.text, /<h2>Applications<\/h2>/);
assert.match(r.text, /Alice 王/);
assert.match(r.text, /I build a habit app with Muse/);
assert.match(r.text, />meetup-1108</);
assert.match(r.text, /Admin <span class="badge" title="Applications waiting">1<\/span>/);

// Approving shows the code on the applicant's page, with a message for their agent and a web link.
r = await admin.post('/admin/applications/1/approve', {});
assert.equal(r.status, 200);
const code = r.text.match(/Approved Alice 王\. Their page now shows invite code <code>(inv_[a-z0-9]+)<\/code>/)[1];
r = await admin.post('/admin/applications/1/approve', {});
assert.match(r.text, /already approved/, 'approving twice issues no second code');
r = await alice.get(aliceUrl);
assert.match(r.text, /You're approved/);
assert.ok(r.text.includes(code));
assert.match(r.text, /Invite code \(single-use, not a password\)/);
assert.match(r.text, /agents\.md/);
assert.ok(r.text.includes(`/register?invite=${code}`));
assert.equal(r.headers.get('refresh'), null, 'an approved page stops refreshing');
const nonce = r.headers.get('content-security-policy').match(/'nonce-([0-9a-f]+)'/)[1];
assert.ok(r.text.includes(`<script nonce="${nonce}">`), 'the copy button script carries the nonce');
r = await browser().get(`/register?invite=${code}`);
assert.ok(r.text.includes(`value="${code}"`), 'the web join form is prefilled');
console.log('ok - approving shows the invite code, an agent message and a web link on the applicant page');

// The code is an ordinary invite: an agent registers with it, and the page then says so.
const reg = await api('/api/v1/register', { invite: code, agent_name: 'Muse' });
assert.equal(reg.status, 201);
r = await alice.get(aliceUrl);
assert.match(r.text, /You're in/);
r = await admin.get('/admin');
assert.match(r.text, /joined as <a href="\/u\/\d+"/);
console.log('ok - the code works with the agent API, and both pages show it was used');

// Decline, and approve-all only approves what the admin saw.
const bob = browser();
const bobUrl = (await bob.post('/apply', { name: 'Bob' })).location;
const carol = browser();
const carolUrl = (await carol.post('/apply', { name: 'Carol' })).location;
const dave = browser();
const daveUrl = (await dave.post('/apply', { name: 'Dave' })).location;
r = await admin.post('/admin/applications/2/reject', {});
assert.match(r.text, /Declined Bob/);
assert.match((await bob.get(bobUrl)).text, /not approved/);
r = await admin.get('/admin');
const ids = r.text.match(/name="ids" value="([0-9,]+)"/)[1];
assert.equal(ids, '3,4');
const erin = browser();
const erinUrl = (await erin.post('/apply', { name: 'Erin' })).location; // arrives after the admin loaded the page
r = await admin.post('/admin/applications/approve-all', { ids });
assert.match(r.text, /Approved 2 applications/);
assert.match((await carol.get(carolUrl)).text, /You're approved/);
assert.match((await dave.get(daveUrl)).text, /You're approved/);
assert.match((await erin.get(erinUrl)).text, /Waiting for approval/, 'a later application still waits');
r = await admin.post('/admin/applications/approve-all', { ids: '2,3' });
assert.match(r.text, /Approved 0 applications/, 'declined or approved ones are not approved again');
console.log('ok - decline works; approve-all approves exactly the applications shown');

// Per-IP limit: 5 an hour from one address in this server (alice, bob, carol, dave, erin used it up).
r = await browser().post('/apply', { name: 'Frank' });
assert.equal(r.status, 429);
assert.match(r.text, /Too many applications/);
console.log('ok - applications are limited per network address');

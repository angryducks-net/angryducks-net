import {
  activityFlags, ALERT_HITS, ALERT_POSTS, alertEmail, BODY_MAX, charLen, detectLang, EMAIL_RE, esc, hasCodeBlock, hotScore, NAME_RE,
  inviteCandidates, normalizeTag, parseTags, prepareUpload, PRODUCT_STATUSES, promoDraft, validProductUrl,
} from './util.js';
import {
  hashPassword, LOCK_AFTER, LOCK_MS, randomCode, randomHex, readCookie, SESSION_MS, sessionCookie, sha256Hex, verifyPassword,
} from './auth.js';
import {
  agentMessage, agentsGuide, AGENT_DAILY_LIMIT, CLAIM_LINK_SECONDS, DRAFTS_PER_MIN, HOLD_SECONDS, inviteMessage, LABEL_MAX, MAX_PENDING_DRAFTS, MAX_TOKENS,
  ownerMessage, SIGNUP_FAILS_PER_HOUR, SIGNUP_PER_IP_DAY, SUMMARY_MAX, TOKEN_PREFIX, UNCLAIMED_POST_LIMIT,
} from './agents-doc.js';
import * as V from './views.js';
import { renderMarkdown, excerpt } from './markdown.js';
import { MANIFESTO_MD } from './manifesto.generated.js';

const MAX_PRODUCTS = 10;
// Anti-flood defaults; override with Worker vars RATE_LIMIT_PER_MIN / DAILY_POST_LIMIT.
const RATE_LIMIT = 3; // posts per minute per user
const DAILY_LIMIT = 30; // posts per 24 hours per user
// Site-wide circuit breakers for the agent API, so many members together cannot run up the bill. Override with
// Worker vars GLOBAL_DRAFTS_PER_DAY / GLOBAL_SIGNUPS_PER_DAY. Set AGENTS_PAUSED=1 to refuse the whole agent API.
const GLOBAL_DRAFTS_PER_DAY = 300;
const GLOBAL_SIGNUPS_PER_DAY = 50;
// Applications to join (D32). Override with Worker vars APPLY_PER_IP_HOUR / APPLY_MAX_PENDING.
const APPLY_PER_IP_HOUR = 30; // an event's wifi shares one IP
const APPLY_MAX_PENDING = 200; // stop taking new ones while this many wait for review
const APPLY_NAME_MAX = 40;
const APPLY_NOTE_MAX = 280;
const APPLY_WINDOW_MAX_HOURS = 24; // the longest an admin can open applications for in one go (D33)
const DEFAULT_CONTACT_EMAIL = 'angryducks.net@gmail.com'; // shown on the home page while applications are closed
const UPLOAD_MAX_BYTES = 100 * 1024;
const LIST_LIMIT = 50;
const SCAN_LIMIT = 500; // newest topics considered for hot ranking

// angryducks.net serves the landing page; every other host is the forum.
// Override with Worker vars HOME_HOSTS / FORUM_ORIGIN (used for local testing).
const DEFAULT_HOME_HOSTS = 'angryducks.net,www.angryducks.net';
const DEFAULT_FORUM_ORIGIN = 'https://community.angryducks.net';
const DEFAULT_HOME_ORIGIN = 'https://angryducks.net';
const REPO_URL = 'https://github.com/angryducks-net/angryducks-net';
// Alert emails: sender must be on the domain onboarded to Cloudflare Email Sending; recipient is the ALERT_TO secret.
const DEFAULT_ALERT_FROM = 'alerts@angryducks.net';
const DAY_MS = 86_400_000;
const ALERT_CRON = '*/15 * * * *'; // must match the second cron in wrangler.toml
let buildVersion = 'dev'; // set from the deploy (Worker var BUILD) on every request; sent as X-AngryDucks-Version
const MANIFESTO_HTML = renderMarkdown(MANIFESTO_MD);

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

export default {
  async fetch(request, env) {
    // Emergency stop: set the Worker var KILL_SWITCH=1 (dashboard, no redeploy) and every request is refused before it touches D1.
    if (switchOn(env.KILL_SWITCH)) return offline();
    buildVersion = env.BUILD || 'dev';
    try {
      return await handle(request, env);
    } catch (err) {
      console.error(err);
      return html(V.layout({ title: 'Error', body: V.messageBody('Something broke', 'Please try again.') }), 500);
    }
  },
  // Cron triggers (wrangler.toml). Every minute: publish agent posts whose hold window ended (D28).
  // Every 15 minutes: email admins about members whose posting looks like a bot (D24).
  async scheduled(event, env, ctx) {
    if (switchOn(env.KILL_SWITCH)) return;
    ctx.waitUntil(
      (async () => {
        await publishDueAgentPosts(env).catch((err) => console.error('agent publish failed', err));
        if (event.cron === ALERT_CRON) await sendAlerts(env).catch((err) => console.error('alerts failed', err));
      })(),
    );
  },
};

// ---------- cost guards ----------

function switchOn(v) {
  return v === '1' || v === 'true';
}

function offline() {
  return new Response('Temporarily offline. Please try again later.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '3600', 'Cache-Control': 'no-store' },
  });
}

// ---------- response helpers ----------

function html(body, status = 200, extra = {}) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS, ...extra } });
}

function redirect(location, extra = {}) {
  return new Response(null, { status: 303, headers: { Location: location, ...extra } });
}

async function page(ctx, title, body, status = 200, headers = {}) {
  const unread = ctx.user ? await unreadTopics(ctx.db, ctx.user.id).then((r) => r.length) : 0;
  const drafts = ctx.user ? await pendingDraftCount(ctx.db, ctx.user.id) : 0;
  const applications = ctx.user?.is_admin
    ? (await ctx.db.prepare("SELECT COUNT(*) AS n FROM applications WHERE status = 'pending'").first()).n
    : 0;
  return html(V.layout({ title, user: ctx.user, unread, drafts, applications, body, homeUrl: ctx.env.HOME_ORIGIN || DEFAULT_HOME_ORIGIN }), status, headers);
}

function message(ctx, title, text, status) {
  return page(ctx, title, V.messageBody(title, text), status);
}

function sameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if (origin) return origin === url.origin;
  const referer = request.headers.get('Referer');
  if (!referer) return false;
  try {
    return new URL(referer).origin === url.origin;
  } catch {
    return false;
  }
}

async function form(request) {
  const data = await request.formData();
  const get = (key) => {
    const v = data.get(key);
    return typeof v === 'string' ? v : '';
  };
  get.file = (key) => {
    const v = data.get(key);
    return v && typeof v === 'object' && typeof v.text === 'function' && v.size > 0 ? v : null;
  };
  return get;
}

// ---------- routing ----------

const routes = [];
function route(method, pattern, handler, { open = false, admin = false } = {}) {
  routes.push({ method, re: new RegExp(`^${pattern}$`), handler, open, admin });
}

// What this deploy is: the git commit and time stamped by `npm run deploy` (Worker vars BUILD / BUILT_AT), 'dev' locally.
function versionInfo(env) {
  return { version: env.BUILD || 'dev', builtAt: env.BUILT_AT || null };
}

// The agent guide with this deploy's limits and version. Served from both domains; only the API origin differs.
function guideText(env, origin) {
  return agentsGuide(origin, {
    ...agentLimits(env),
    signupFailsPerHour: limitFrom(env, 'SIGNUP_FAILS_PER_HOUR', SIGNUP_FAILS_PER_HOUR),
    contactEmail: contactEmail(env),
    ...versionInfo(env),
  });
}

// Entry points for agents are never cached: a stale guide leaves an agent stuck on instructions that no longer match.
function guideResponse(env, origin) {
  return new Response(guideText(env, origin), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
      'X-AngryDucks-Version': versionInfo(env).version,
      Vary: 'Accept',
    },
  });
}

function versionResponse(env) {
  const { version, builtAt } = versionInfo(env);
  return new Response(JSON.stringify({ version, built_at: builtAt }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
      'X-AngryDucks-Version': version,
    },
  });
}

// True when the client asks for Markdown ahead of HTML (what agents that read web pages send).
function wantsMarkdown(request) {
  const accept = request.headers.get('Accept') || '';
  const md = accept.indexOf('text/markdown');
  const htm = accept.indexOf('text/html');
  return md !== -1 && (htm === -1 || md < htm);
}

async function handleHome(request, env, url) {
  const forumOrigin = env.FORUM_ORIGIN || DEFAULT_FORUM_ORIGIN;
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  if (url.pathname === '/favicon.svg') {
    return new Response(V.FAVICON_SVG, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
  }
  // Agents given only this address find their instructions here: /agents.md, /llms.txt, or Markdown from /.
  if (url.pathname === '/version.json') return versionResponse(env);
  if (url.pathname === '/agents.md' || url.pathname === '/llms.txt' || (url.pathname === '/' && wantsMarkdown(request))) {
    return guideResponse(env, forumOrigin);
  }
  if (url.pathname !== '/') return redirect(forumOrigin + url.pathname + url.search);
  // Who can join (D33): a member sees nothing about it; otherwise the apply button while applications are open, else
  // the address to email.
  const member = readCookie(request, MEMBER_COOKIE) === '1';
  const applyOpen = !member && (await applyOpenUntil(env.DB)) > Date.now();
  const page = V.homePage({
    manifestoHtml: MANIFESTO_HTML, forumUrl: forumOrigin, repoUrl: REPO_URL, homeUrl: url.origin,
    join: member ? 'member' : applyOpen ? 'apply' : 'email', contactEmail: contactEmail(env),
  });
  // Not cached: an agent that reads a stale copy of this page misses the instructions for joining.
  return html(page, 200, {
    'Cache-Control': 'no-cache',
    Vary: 'Accept, Cookie',
    'X-AngryDucks-Version': buildVersion,
  });
}

async function handle(request, env) {
  const url = new URL(request.url);
  const homeHosts = (env.HOME_HOSTS || DEFAULT_HOME_HOSTS).split(',').map((h) => h.trim());
  if (homeHosts.includes(url.hostname)) return handleHome(request, env, url);
  // Agent API: bearer token, no cookies, so the same-origin check below does not apply.
  if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  if (method === 'POST' && !sameOrigin(request, url)) {
    return new Response('Cross-origin request blocked.', { status: 403 });
  }
  const db = env.DB;
  const ctx = { request, env, db, url, secure: url.protocol === 'https:', user: await loadUser(request, db) };
  let path;
  try {
    path = decodeURI(url.pathname);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = path.match(r.re);
    if (!m) continue;
    if (!r.open && !ctx.user) return method === 'GET' ? redirect('/login') : message(ctx, 'Log in first', 'Your session has ended. Please log in again.', 401);
    if (r.admin && !ctx.user.is_admin) return message(ctx, 'Not allowed', 'Admins only.', 403);
    return r.handler(ctx, ...m.slice(1));
  }
  return message(ctx, 'Not found', 'This page does not exist.', 404);
}

// ---------- sessions ----------

async function loadUser(request, db) {
  const token = readCookie(request, 'sid');
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  return db
    .prepare(
      `SELECT u.id, u.name, u.email, u.bio, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.banned_at IS NULL`,
    )
    .bind(await sha256Hex(token), Date.now())
    .first();
}

async function startSession(ctx, userId, location = '/') {
  const token = randomHex(32);
  await ctx.db
    .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), userId, Date.now() + SESSION_MS)
    .run();
  return redirectWithCookies(location, [sessionCookie(token, ctx.secure), memberCookie(ctx, true)]);
}

function redirectWithCookies(location, cookies) {
  const headers = new Headers({ Location: location });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 303, headers });
}

// A marker that this browser has a member logged in, readable on angryducks.net as well, where the session cookie
// (host-only, on the forum) is not sent. It holds no secret: it only hides the home page's "apply" line (D33).
const MEMBER_COOKIE = 'ad_member';
function memberCookie(ctx, on) {
  const home = (ctx.env.HOME_HOSTS || DEFAULT_HOME_HOSTS).split(',')[0].trim();
  const domain = ctx.url.hostname.endsWith(`.${home}`) ? `; Domain=${home}` : '';
  return `${MEMBER_COOKIE}=${on ? '1' : ''}; Path=/${domain}; SameSite=Lax; Max-Age=${on ? SESSION_MS / 1000 : 0}${ctx.secure ? '; Secure' : ''}`;
}

// ---------- shared queries ----------

function limitFrom(env, key, fallback) {
  const n = Number(env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Which anti-flood limit a new post by this user would break: 'minute', 'day', 'dupe', or null. Records nothing.
async function floodReason(env, db, userId, body) {
  const now = Date.now();
  const perMin = limitFrom(env, 'RATE_LIMIT_PER_MIN', RATE_LIMIT);
  const perDay = limitFrom(env, 'DAILY_POST_LIMIT', DAILY_LIMIT);
  const row = await db
    .prepare(
      `SELECT SUM(created_at > ?2) AS last_min, COUNT(*) AS last_day,
         SUM(body = ?3 AND deleted_at IS NULL) AS dupes
       FROM content WHERE author_id = ?1 AND created_at > ?4`,
    )
    .bind(userId, now - 60_000, body, now - DAY_MS)
    .first();
  if ((row.last_min || 0) >= perMin) return { reason: 'minute', perMin, perDay };
  if ((row.last_day || 0) >= perDay) return { reason: 'day', perMin, perDay };
  if ((row.dupes || 0) > 0) return { reason: 'dupe', perMin, perDay };
  return null;
}

// Returns an error page if the user is posting too fast, too much, or repeating themselves; else null.
async function floodCheck(ctx, body) {
  const found = await floodReason(ctx.env, ctx.db, ctx.user.id, body);
  if (!found) return null;
  const { reason, perMin, perDay } = found;
  // Every rejection is recorded: repeatedly hitting the limits is the clearest sign of a script.
  await ctx.db.prepare('INSERT INTO flood_hits (user_id, reason, created_at) VALUES (?, ?, ?)').bind(ctx.user.id, reason, Date.now()).run();
  if (reason === 'minute') return message(ctx, 'Slow down', `You can post up to ${perMin} times per minute. Wait a moment and try again.`, 429);
  if (reason === 'day') return message(ctx, 'Daily limit reached', `You can post up to ${perDay} times per day. Come back tomorrow.`, 429);
  return message(ctx, 'Already posted', 'You posted the same text in the last 24 hours.', 409);
}

// SQL condition: the user in `col` is not banned. A ban hides a member's posts, replies and votes
// from everyone but admins; the rows stay in the database for investigation and come back on unban.
const notBanned = (col) => `${col} NOT IN (SELECT id FROM users WHERE banned_at IS NOT NULL)`;

async function markRead(db, userId, topicId) {
  await db
    .prepare(
      `INSERT INTO topic_reads (user_id, topic_id, read_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (user_id, topic_id) DO UPDATE SET read_at = excluded.read_at`,
    )
    .bind(userId, topicId, Date.now())
    .run();
}

// Topics the user started or replied to that have replies from others since they last read it.
async function unreadTopics(db, userId) {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.title, t.lang, COUNT(r.id) AS new_count, MAX(r.created_at) AS last_at
       FROM content t
       JOIN content r ON r.topic_id = t.id AND r.author_id != ?1 AND r.deleted_at IS NULL AND ${notBanned('r.author_id')}
       LEFT JOIN topic_reads tr ON tr.user_id = ?1 AND tr.topic_id = t.id
       WHERE t.kind = 'topic' AND t.deleted_at IS NULL AND ${notBanned('t.author_id')}
         AND (t.author_id = ?1 OR EXISTS (SELECT 1 FROM content m WHERE m.topic_id = t.id AND m.author_id = ?1))
         AND r.created_at > COALESCE(tr.read_at, 0)
       GROUP BY t.id
       ORDER BY last_at DESC`,
    )
    .bind(userId)
    .all();
  return results;
}

async function tagsFor(db, ids) {
  const map = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return map;
  const { results } = await db
    .prepare(
      `SELECT ct.content_id, t.name FROM content_tags ct JOIN tags t ON t.id = ct.tag_id
       WHERE ct.content_id IN (${ids.map(() => '?').join(',')}) ORDER BY t.name`,
    )
    .bind(...ids)
    .all();
  for (const r of results) map.get(r.content_id).push(r.name);
  return map;
}

async function setTags(db, contentId, tags) {
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM content_tags WHERE content_id = ? AND source = 'author'").bind(contentId),
    ...tags.map((t) => db.prepare('INSERT OR IGNORE INTO tags (name, created_at) VALUES (?, ?)').bind(t, now)),
    ...tags.map((t) =>
      db
        .prepare("INSERT OR IGNORE INTO content_tags (content_id, tag_id, source) SELECT ?, id, 'author' FROM tags WHERE name = ?")
        .bind(contentId, t),
    ),
  ]);
}

async function hotTopics(db, tag) {
  const filter = tag ? 'AND c.id IN (SELECT ct.content_id FROM content_tags ct JOIN tags g ON g.id = ct.tag_id WHERE g.name = ?)' : '';
  const stmt = db.prepare(
    `SELECT c.id, c.title, c.lang, c.author_id, c.created_at, c.via_agent, u.name AS author_name,
       substr(c.body, 1, 600) AS body_head,
       (SELECT COUNT(*) FROM votes v WHERE v.content_id = c.id AND ${notBanned('v.user_id')}) AS votes,
       (SELECT COUNT(*) FROM content r WHERE r.topic_id = c.id AND r.deleted_at IS NULL AND ${notBanned('r.author_id')}) AS replies,
       (SELECT COUNT(DISTINCT r.author_id) FROM content r
          WHERE r.topic_id = c.id AND r.deleted_at IS NULL AND r.author_id != c.author_id AND ${notBanned('r.author_id')}) AS repliers
     FROM content c JOIN users u ON u.id = c.author_id
     WHERE c.kind = 'topic' AND c.deleted_at IS NULL AND u.banned_at IS NULL ${filter}
     ORDER BY c.created_at DESC LIMIT ${SCAN_LIMIT}`,
  );
  const { results } = await (tag ? stmt.bind(tag) : stmt).all();
  const now = Date.now();
  const top = results
    .map((t) => ({ ...t, score: hotScore({ votes: t.votes, repliers: t.repliers, createdAt: t.created_at }, now) }))
    .sort((a, b) => b.score - a.score || b.created_at - a.created_at)
    .slice(0, LIST_LIMIT);
  const tags = await tagsFor(db, top.map((t) => t.id));
  return top.map((t) => ({ ...t, tags: tags.get(t.id), excerpt: excerpt(t.body_head) }));
}

async function popularTags(db) {
  const { results } = await db
    .prepare(
      `SELECT t.name, COUNT(*) AS n FROM content_tags ct
       JOIN tags t ON t.id = ct.tag_id JOIN content c ON c.id = ct.content_id
       WHERE c.deleted_at IS NULL AND ${notBanned('c.author_id')} GROUP BY t.id ORDER BY n DESC, t.name LIMIT 30`,
    )
    .all();
  return results;
}

async function getContent(db, id) {
  return db
    .prepare('SELECT c.*, u.name AS author_name, u.banned_at AS author_banned_at FROM content c JOIN users u ON u.id = c.author_id WHERE c.id = ?')
    .bind(Number(id))
    .first();
}

// Content by a banned member is visible to admins only.
function visibleTo(user, c) {
  return !!c && (!c.author_banned_at || !!user.is_admin);
}

// ---------- validation ----------

const CODE_ERROR = "Code blocks aren't shared here. Put the code in your repo or doc and link to it.";
const LENGTH_ERROR = `Posts are limited to ${BODY_MAX} characters. For longer writing, post a summary and link to the full article (Substack, your blog, a GitHub repo...).`;

function bodyError(body) {
  if (!body) return 'Write something first.';
  if (charLen(body) > BODY_MAX) return `${LENGTH_ERROR} (Yours is ${charLen(body)}.)`;
  if (hasCodeBlock(body)) return CODE_ERROR;
  return null;
}

function validateTopic(get) {
  const values = { title: get('title').trim(), body: get('body').trim(), tags: get('tags') };
  if (!values.title || charLen(values.title) > 100) return { values, error: 'Title is required and must be at most 100 characters.' };
  const err = bodyError(values.body);
  if (err) return { values, error: err };
  const parsed = parseTags(values.tags);
  if (parsed.error) return { values, error: parsed.error };
  return { values, tags: parsed.tags };
}

function validateBody(text) {
  const body = text.trim();
  const err = bodyError(body);
  return err ? { body, error: err } : { body };
}

function validateProduct(get) {
  const values = { name: get('name').trim(), pitch: get('pitch').trim(), url: get('url').trim(), status: get('status') };
  if (!values.name || charLen(values.name) > 60) return { values, error: 'Name is required and must be at most 60 characters.' };
  if (charLen(values.pitch) > 140) return { values, error: 'Pitch must be at most 140 characters.' };
  if (!PRODUCT_STATUSES.includes(values.status)) return { values, error: 'Pick a status.' };
  const link = validProductUrl(values.url);
  if (link.error) return { values, error: link.error };
  return { values: { ...values, url: link.url } };
}

// ---------- static ----------

route('GET', '/favicon.svg', () =>
  new Response(V.FAVICON_SVG, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } }),
  { open: true });

// ---------- auth ----------

route('GET', '/login', (ctx) => (ctx.user ? redirect('/') : page(ctx, 'Log in', V.loginBody({}))), { open: true });

route('POST', '/login', async (ctx) => {
  const get = await form(ctx.request);
  const email = get('email').trim().toLowerCase();
  const password = get('password');
  const fail = (error, status = 400) => page(ctx, 'Log in', V.loginBody({ error, values: { email } }), status);
  const u = await ctx.db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  const now = Date.now();
  if (!u) {
    await hashPassword(password); // keep timing similar for unknown emails
    return fail('Wrong email or password.');
  }
  if (u.locked_until && u.locked_until > now) return fail('Too many failed attempts. Try again in 15 minutes.', 429);
  if (!(await verifyPassword(password, u.pw_hash, u.pw_salt))) {
    const fails = u.failed_logins + 1;
    if (fails >= LOCK_AFTER) {
      await ctx.db.prepare('UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?').bind(now + LOCK_MS, u.id).run();
      return fail('Too many failed attempts. Try again in 15 minutes.', 429);
    }
    await ctx.db.prepare('UPDATE users SET failed_logins = ? WHERE id = ?').bind(fails, u.id).run();
    return fail('Wrong email or password.');
  }
  if (u.banned_at) return fail('This account is suspended.', 403);
  await ctx.db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').bind(u.id).run();
  return startSession(ctx, u.id);
}, { open: true });

// ?invite= prefills the code: an approved application's page links here (D32).
route('GET', '/register', (ctx) =>
  ctx.user ? redirect('/') : page(ctx, 'Join', V.registerBody({ values: { invite: (ctx.url.searchParams.get('invite') || '').slice(0, 64) } })),
  { open: true });

route('POST', '/register', async (ctx) => {
  const get = await form(ctx.request);
  const values = { invite: get('invite').trim(), email: get('email').trim().toLowerCase(), name: get('name').trim() };
  const password = get('password');
  const fail = (error) => page(ctx, 'Join', V.registerBody({ error, values }), 400);
  if (!EMAIL_RE.test(values.email) || values.email.length > 254) return fail('Enter a valid email address.');
  if (!NAME_RE.test(values.name)) return fail('Display name must be 2–24 letters, numbers, - or _.');
  if (password.length < 8 || password.length > 200) return fail('Password must be at least 8 characters.');

  const db = ctx.db;
  const { n: userCount } = await db.prepare('SELECT COUNT(*) AS n FROM users').first();
  const bootstrap = userCount === 0;
  if (bootstrap) {
    // The very first account must use the BOOTSTRAP_CODE secret and becomes admin.
    if (!ctx.env.BOOTSTRAP_CODE || values.invite !== ctx.env.BOOTSTRAP_CODE) return fail('Invalid invite code.');
  } else {
    const invite = await db.prepare('SELECT code FROM invites WHERE code = ? AND used_by IS NULL').bind(values.invite).first();
    if (!invite) return fail('Invalid or already used invite code.');
  }
  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(values.email).first()) return fail('That email is already registered.');
  if (await db.prepare('SELECT 1 FROM users WHERE name_key = ?').bind(values.name.toLowerCase()).first()) return fail('That display name is taken.');

  const { hash, salt } = await hashPassword(password);
  const now = Date.now();
  const stmts = [
    db
      .prepare('INSERT INTO users (email, name, name_key, pw_hash, pw_salt, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(values.email, values.name, values.name.toLowerCase(), hash, salt, bootstrap ? 1 : 0, now),
  ];
  if (!bootstrap) {
    stmts.push(
      db
        .prepare('UPDATE invites SET used_by = (SELECT id FROM users WHERE email = ?), used_at = ? WHERE code = ? AND used_by IS NULL')
        .bind(values.email, now, values.invite),
    );
  }
  await db.batch(stmts);
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(values.email).first();
  return startSession(ctx, user.id);
}, { open: true });

route('POST', '/logout', async (ctx) => {
  const token = readCookie(ctx.request, 'sid');
  if (token) await ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return redirectWithCookies('/login', [sessionCookie('', ctx.secure, 0), memberCookie(ctx, false)]);
}, { open: true });

// ---------- topics ----------

route('GET', '/', async (ctx) => {
  const [topics, tags] = await Promise.all([hotTopics(ctx.db), popularTags(ctx.db)]);
  return page(ctx, 'Hot topics', V.topicListBody({ topics, tags }));
});

route('GET', '/t/([^/]+)', async (ctx, tag) => {
  const [topics, tags] = await Promise.all([hotTopics(ctx.db, tag), popularTags(ctx.db)]);
  return page(ctx, `#${tag}`, V.topicListBody({ topics, tags, activeTag: tag }));
});

function newTopicForm(ctx, opts = {}, status = 200) {
  return page(ctx, 'New topic', V.topicFormBody({ action: '/new', heading: 'New topic', upload: true, ...opts }), status);
}

route('GET', '/new', (ctx) => newTopicForm(ctx));

// "Load file" fills the form from an uploaded Markdown file for the author to review; it never posts.
async function loadUpload(ctx, get) {
  const values = { title: get('title').trim(), body: get('body'), tags: get('tags') };
  const file = get.file('mdfile');
  if (!file) return newTopicForm(ctx, { values, error: 'Choose a .md file first.' }, 400);
  if (!/\.(md|markdown|txt)$/i.test(file.name || '')) return newTopicForm(ctx, { values, error: 'Only .md, .markdown or .txt files.' }, 400);
  if (file.size > UPLOAD_MAX_BYTES) return newTopicForm(ctx, { values, error: 'File is larger than 100 KB.' }, 400);
  const prepared = prepareUpload(await file.text());
  const notes = [];
  if (prepared.shortened) notes.push(`The file is longer than ${BODY_MAX} characters, so only the beginning was kept.`);
  if (prepared.codeRemoved) notes.push('Code blocks were removed.');
  if (notes.length) notes.push('Edit it into a short summary and paste the link to the full article (Substack, your blog, a GitHub repo...) after "Full version:".');
  return newTopicForm(ctx, {
    values: { title: values.title || prepared.title, body: prepared.body, tags: values.tags },
    notice: notes.length ? notes.join(' ') : 'File loaded. Review it, add tags, then post.',
  });
}

route('POST', '/new', async (ctx) => {
  const get = await form(ctx.request);
  // Enter in a text field triggers the first button (Load file); without a file, treat it as Post.
  if (get('op') === 'load' && get.file('mdfile')) return loadUpload(ctx, get);
  const v = validateTopic(get);
  if (v.error) return newTopicForm(ctx, { values: v.values, error: v.error }, 400);
  const flood = await floodCheck(ctx, v.values.body);
  if (flood) return flood;
  const now = Date.now();
  const row = await ctx.db
    .prepare("INSERT INTO content (kind, author_id, title, body, lang, created_at) VALUES ('topic', ?, ?, ?, ?, ?) RETURNING id")
    .bind(ctx.user.id, v.values.title, v.values.body, detectLang(v.values.title, v.values.body), now)
    .first();
  await setTags(ctx.db, row.id, v.tags);
  await markRead(ctx.db, ctx.user.id, row.id);
  return redirect(`/topic/${row.id}`);
});

async function renderTopic(ctx, id, { error, draft, status = 200 } = {}) {
  const topic = await getContent(ctx.db, id);
  if (!visibleTo(ctx.user, topic) || topic.kind !== 'topic') return message(ctx, 'Not found', 'This topic does not exist.', 404);
  await markRead(ctx.db, ctx.user.id, topic.id);
  const [{ results: allReplies }, tags, voteRow, mine] = await Promise.all([
    ctx.db
      .prepare(
        `SELECT c.*, u.name AS author_name, u.banned_at AS author_banned_at FROM content c JOIN users u ON u.id = c.author_id
         WHERE c.topic_id = ? ORDER BY c.created_at, c.id`,
      )
      .bind(topic.id)
      .all(),
    tagsFor(ctx.db, [topic.id]),
    ctx.db.prepare(`SELECT COUNT(*) AS n FROM votes WHERE content_id = ? AND ${notBanned('user_id')}`).bind(topic.id).first(),
    ctx.db.prepare('SELECT 1 FROM votes WHERE content_id = ? AND user_id = ?').bind(topic.id, ctx.user.id).first(),
  ]);
  const replies = allReplies.filter((r) => visibleTo(ctx.user, r));
  const title = topic.deleted_at ? '[deleted topic]' : topic.title;
  return page(
    ctx,
    title,
    V.topicBody({ topic, tags: tags.get(topic.id), replies, votes: voteRow.n, voted: !!mine, user: ctx.user, error, draft }),
    status,
  );
}

route('GET', '/topic/(\\d+)', (ctx, id) => renderTopic(ctx, id));

route('POST', '/topic/(\\d+)/reply', async (ctx, id) => {
  const get = await form(ctx.request);
  const topic = await getContent(ctx.db, id);
  if (!visibleTo(ctx.user, topic) || topic.kind !== 'topic' || topic.deleted_at) return message(ctx, 'Not found', 'This topic does not exist.', 404);
  const v = validateBody(get('body'));
  if (v.error) return renderTopic(ctx, id, { error: v.error, draft: v.body, status: 400 });
  const flood = await floodCheck(ctx, v.body);
  if (flood) return flood;
  const row = await ctx.db
    .prepare("INSERT INTO content (kind, topic_id, author_id, body, lang, created_at) VALUES ('reply', ?, ?, ?, ?, ?) RETURNING id")
    .bind(topic.id, ctx.user.id, v.body, detectLang(v.body), Date.now())
    .first();
  await markRead(ctx.db, ctx.user.id, topic.id);
  return redirect(`/topic/${topic.id}#c${row.id}`);
});

route('POST', '/topic/(\\d+)/vote', async (ctx, id) => {
  const topic = await getContent(ctx.db, id);
  if (!visibleTo(ctx.user, topic) || topic.kind !== 'topic' || topic.deleted_at) return message(ctx, 'Not found', 'This topic does not exist.', 404);
  if (topic.author_id === ctx.user.id) return message(ctx, 'Not allowed', "You can't vote on your own topic.", 400);
  const existing = await ctx.db.prepare('SELECT 1 FROM votes WHERE user_id = ? AND content_id = ?').bind(ctx.user.id, topic.id).first();
  if (existing) {
    await ctx.db.prepare('DELETE FROM votes WHERE user_id = ? AND content_id = ?').bind(ctx.user.id, topic.id).run();
  } else {
    await ctx.db.prepare('INSERT INTO votes (user_id, content_id, created_at) VALUES (?, ?, ?)').bind(ctx.user.id, topic.id, Date.now()).run();
  }
  return redirect(`/topic/${topic.id}`);
});

// ---------- edit / delete (topics and replies) ----------

async function editable(ctx, id) {
  const c = await getContent(ctx.db, id);
  if (!c || c.deleted_at) return { res: await message(ctx, 'Not found', 'This post does not exist.', 404) };
  if (c.author_id !== ctx.user.id) return { res: await message(ctx, 'Not allowed', 'You can only edit your own posts.', 403) };
  return { c };
}

function editForm(c, values, error) {
  const isTopic = c.kind === 'topic';
  return V.topicFormBody({ action: `/c/${c.id}/edit`, heading: isTopic ? 'Edit topic' : 'Edit reply', values, error, isTopic });
}

route('GET', '/c/(\\d+)/edit', async (ctx, id) => {
  const { c, res } = await editable(ctx, id);
  if (res) return res;
  const tags = c.kind === 'topic' ? (await tagsFor(ctx.db, [c.id])).get(c.id).join(', ') : '';
  return page(ctx, 'Edit', editForm(c, { title: c.title, body: c.body, tags }));
});

route('POST', '/c/(\\d+)/edit', async (ctx, id) => {
  const get = await form(ctx.request);
  const { c, res } = await editable(ctx, id);
  if (res) return res;
  const now = Date.now();
  if (c.kind === 'topic') {
    const v = validateTopic(get);
    if (v.error) return page(ctx, 'Edit', editForm(c, v.values, v.error), 400);
    await ctx.db
      .prepare('UPDATE content SET title = ?, body = ?, lang = ?, edited_at = ? WHERE id = ?')
      .bind(v.values.title, v.values.body, detectLang(v.values.title, v.values.body), now, c.id)
      .run();
    await setTags(ctx.db, c.id, v.tags);
    return redirect(`/topic/${c.id}`);
  }
  const v = validateBody(get('body'));
  if (v.error) return page(ctx, 'Edit', editForm(c, { body: v.body }, v.error), 400);
  await ctx.db.prepare('UPDATE content SET body = ?, lang = ?, edited_at = ? WHERE id = ?').bind(v.body, detectLang(v.body), now, c.id).run();
  return redirect(`/topic/${c.topic_id}#c${c.id}`);
});

route('POST', '/c/(\\d+)/delete', async (ctx, id) => {
  const c = await getContent(ctx.db, id);
  if (!c || c.deleted_at) return message(ctx, 'Not found', 'This post does not exist.', 404);
  if (c.author_id !== ctx.user.id && !ctx.user.is_admin) return message(ctx, 'Not allowed', 'You can only delete your own posts.', 403);
  await ctx.db.prepare('UPDATE content SET deleted_at = ? WHERE id = ?').bind(Date.now(), c.id).run();
  return redirect(c.kind === 'topic' ? '/' : `/topic/${c.topic_id}`);
});

// ---------- notifications ----------

route('GET', '/notifications', async (ctx) => page(ctx, 'New replies', V.notificationsBody({ topics: await unreadTopics(ctx.db, ctx.user.id) })));

// ---------- profiles and product cards ----------

async function renderProfile(ctx, id, { error, values, status = 200 } = {}) {
  const profile = await ctx.db.prepare('SELECT id, name, bio, banned_at, created_at FROM users WHERE id = ?').bind(Number(id)).first();
  if (!profile || (profile.banned_at && !ctx.user.is_admin)) return message(ctx, 'Not found', 'This member does not exist.', 404);
  const [{ results: products }, { results: topics }, { results: recent }] = await Promise.all([
    ctx.db.prepare('SELECT * FROM products WHERE user_id = ? ORDER BY created_at DESC, id DESC').bind(profile.id).all(),
    ctx.db
      .prepare("SELECT id, title, lang, created_at FROM content WHERE author_id = ? AND kind = 'topic' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50")
      .bind(profile.id)
      .all(),
    // Admins see every post, replies and deleted ones included, to investigate suspected bots.
    ctx.user.is_admin
      ? ctx.db
          .prepare('SELECT id, kind, topic_id, title, body, created_at, deleted_at FROM content WHERE author_id = ? ORDER BY created_at DESC LIMIT 100')
          .bind(profile.id)
          .all()
      : { results: null },
  ]);
  const own = profile.id === ctx.user.id;
  return page(ctx, profile.name, V.profileBody({ profile, products, topics, recent, own, error, values, maxProducts: MAX_PRODUCTS }), status);
}

route('GET', '/u/(\\d+)', (ctx, id) => renderProfile(ctx, id));

route('POST', '/products', async (ctx) => {
  const get = await form(ctx.request);
  const v = validateProduct(get);
  if (v.error) return renderProfile(ctx, ctx.user.id, { error: v.error, values: v.values, status: 400 });
  const { n } = await ctx.db.prepare('SELECT COUNT(*) AS n FROM products WHERE user_id = ?').bind(ctx.user.id).first();
  if (n >= MAX_PRODUCTS) return renderProfile(ctx, ctx.user.id, { error: `You can have at most ${MAX_PRODUCTS} cards.`, values: v.values, status: 400 });
  await ctx.db
    .prepare('INSERT INTO products (user_id, name, pitch, url, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(ctx.user.id, v.values.name, v.values.pitch, v.values.url, v.values.status, Date.now())
    .run();
  return redirect(`/u/${ctx.user.id}`);
});

async function ownProduct(ctx, id) {
  const p = await ctx.db.prepare('SELECT * FROM products WHERE id = ?').bind(Number(id)).first();
  if (!p || p.user_id !== ctx.user.id) return { res: await message(ctx, 'Not found', 'This card does not exist.', 404) };
  return { p };
}

route('GET', '/products/(\\d+)/edit', async (ctx, id) => {
  const { p, res } = await ownProduct(ctx, id);
  return res || page(ctx, 'Edit product', V.productEditBody({ product: p }));
});

route('POST', '/products/(\\d+)/edit', async (ctx, id) => {
  const get = await form(ctx.request);
  const { p, res } = await ownProduct(ctx, id);
  if (res) return res;
  const v = validateProduct(get);
  if (v.error) return page(ctx, 'Edit product', V.productEditBody({ product: p, error: v.error, values: v.values }), 400);
  await ctx.db
    .prepare('UPDATE products SET name = ?, pitch = ?, url = ?, status = ? WHERE id = ?')
    .bind(v.values.name, v.values.pitch, v.values.url, v.values.status, p.id)
    .run();
  return redirect(`/u/${ctx.user.id}`);
});

// Opens the new-topic form filled with a promo post for the card; the author reviews it, then posts.
route('GET', '/products/(\\d+)/promote', async (ctx, id) => {
  const { p, res } = await ownProduct(ctx, id);
  if (res) return res;
  return newTopicForm(ctx, {
    values: promoDraft(p),
    notice: `Draft generated from your "${p.name}" card. Replace the [bracketed] parts, then post.`,
  });
});

route('POST', '/products/(\\d+)/delete', async (ctx, id) => {
  const { p, res } = await ownProduct(ctx, id);
  if (res) return res;
  await ctx.db.prepare('DELETE FROM products WHERE id = ?').bind(p.id).run();
  return redirect(`/u/${ctx.user.id}`);
});

// ---------- settings ----------

function settingsPage(ctx, opts = {}, status = 200) {
  return page(ctx, 'Settings', V.settingsBody({ user: ctx.user, ...opts }), status);
}

route('GET', '/settings', (ctx) => settingsPage(ctx));

route('POST', '/settings', async (ctx) => {
  const get = await form(ctx.request);
  const values = { name: get('name').trim(), bio: get('bio').trim() };
  const fail = (error) => settingsPage(ctx, { error, values }, 400);
  if (!NAME_RE.test(values.name)) return fail('Display name must be 2–24 letters, numbers, - or _.');
  if (charLen(values.bio) > 160) return fail('Bio must be at most 160 characters.');
  const taken = await ctx.db.prepare('SELECT 1 FROM users WHERE name_key = ? AND id != ?').bind(values.name.toLowerCase(), ctx.user.id).first();
  if (taken) return fail('That display name is taken.');
  await ctx.db
    .prepare('UPDATE users SET name = ?, name_key = ?, bio = ? WHERE id = ?')
    .bind(values.name, values.name.toLowerCase(), values.bio, ctx.user.id)
    .run();
  ctx.user = { ...ctx.user, ...values };
  return settingsPage(ctx, { notice: 'Profile saved.' });
});

route('POST', '/settings/password', async (ctx) => {
  const get = await form(ctx.request);
  const fail = (error) => settingsPage(ctx, { error }, 400);
  const row = await ctx.db.prepare('SELECT pw_hash, pw_salt FROM users WHERE id = ?').bind(ctx.user.id).first();
  if (!(await verifyPassword(get('current'), row.pw_hash, row.pw_salt))) return fail('Current password is wrong.');
  const next = get('password');
  if (next.length < 8 || next.length > 200) return fail('New password must be at least 8 characters.');
  const { hash, salt } = await hashPassword(next);
  await ctx.db.batch([
    ctx.db.prepare('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?').bind(hash, salt, ctx.user.id),
    ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(ctx.user.id),
  ]);
  return startSession(ctx, ctx.user.id, '/settings');
});

// ---------- agents (D27, D28) ----------
// A member gives their personal agent a token. The agent can read the forum and submit posts, each with a
// summary of what it did. A post is held for a short window, during which the member can retract it; then it goes
// live under the member's name, labelled "via <agent>". Rows live in agent_drafts (the name predates D28).

// Hold window and daily submission cap; override with Worker vars AGENT_HOLD_SECONDS / AGENT_DAILY_LIMIT.
function agentLimits(env) {
  return {
    holdSeconds: limitFrom(env, 'AGENT_HOLD_SECONDS', HOLD_SECONDS),
    dailyLimit: limitFrom(env, 'AGENT_DAILY_LIMIT', AGENT_DAILY_LIMIT),
    unclaimedLimit: limitFrom(env, 'UNCLAIMED_POST_LIMIT', UNCLAIMED_POST_LIMIT),
    claimSeconds: limitFrom(env, 'CLAIM_LINK_SECONDS', CLAIM_LINK_SECONDS),
  };
}

async function pendingDraftCount(db, userId) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM agent_drafts WHERE user_id = ? AND status = 'pending'").bind(userId).first();
  return row.n;
}

route('GET', '/agents\\.md', (ctx) => guideResponse(ctx.env, ctx.url.origin), { open: true });
route('GET', '/llms\\.txt', (ctx) => guideResponse(ctx.env, ctx.url.origin), { open: true });
route('GET', '/version\\.json', (ctx) => versionResponse(ctx.env), { open: true });

// The Agents page. A freshly created token is shown once, together with a copy button, which needs
// a script: this is the only page whose CSP allows one, and only the inline script carrying its nonce.
async function agentsPage(ctx, opts = {}, status = 200) {
  const { results: tokens } = await ctx.db
    .prepare('SELECT id, label, created_at, last_used_at, revoked_at FROM agent_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
    .bind(ctx.user.id)
    .all();
  const nonce = randomHex(16);
  const headers = { 'Cache-Control': 'no-store' };
  if (opts.newToken) headers['Content-Security-Policy'] = `${SECURITY_HEADERS['Content-Security-Policy']}; script-src 'nonce-${nonce}'`;
  const message = opts.newToken ? agentMessage(ctx.url.origin, opts.newToken.token) : null;
  const holdMinutes = Math.max(1, Math.round(agentLimits(ctx.env).holdSeconds / 60));
  const waiting = await pendingDraftCount(ctx.db, ctx.user.id);
  return page(ctx, 'Your agent', V.agentsBody({ tokens, message, nonce, holdMinutes, waiting, ...opts }), status, headers);
}

route('GET', '/agents', (ctx) => agentsPage(ctx));

route('POST', '/agents', async (ctx) => {
  const get = await form(ctx.request);
  const label = get('label').replace(/\s+/g, ' ').trim();
  if (!label || charLen(label) > LABEL_MAX) {
    return agentsPage(ctx, { error: `Agent name is required and must be at most ${LABEL_MAX} characters.` }, 400);
  }
  const { n } = await ctx.db.prepare('SELECT COUNT(*) AS n FROM agent_tokens WHERE user_id = ? AND revoked_at IS NULL').bind(ctx.user.id).first();
  if (n >= MAX_TOKENS) return agentsPage(ctx, { error: `You can have at most ${MAX_TOKENS} active tokens. Revoke one first.` }, 400);
  const token = TOKEN_PREFIX + randomHex(24);
  await ctx.db
    .prepare('INSERT INTO agent_tokens (user_id, label, token_hash, created_at) VALUES (?, ?, ?, ?)')
    .bind(ctx.user.id, label, await sha256Hex(token), Date.now())
    .run();
  return agentsPage(ctx, { newToken: { label, token } });
});

route('POST', '/agents/(\\d+)/revoke', async (ctx, id) => {
  await ctx.db
    .prepare('UPDATE agent_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(Date.now(), Number(id), ctx.user.id)
    .run();
  // Emergency switch: posts this agent still has in the hold window stop going live by themselves.
  // They stay in the list for the member to publish or retract by hand.
  await ctx.db
    .prepare("UPDATE agent_drafts SET publish_at = NULL WHERE token_id = ? AND user_id = ? AND status = 'pending'")
    .bind(Number(id), ctx.user.id)
    .run();
  return agentsPage(ctx, { notice: 'Token revoked. That agent can no longer use the forum, and its waiting posts will not go live on their own.' });
});

route('GET', '/drafts', async (ctx) => {
  const [{ results: waiting }, { results: history }] = await Promise.all([
    ctx.db
      .prepare(
        `SELECT d.*, t.label AS agent, tp.title AS topic_title FROM agent_drafts d
         JOIN agent_tokens t ON t.id = d.token_id LEFT JOIN content tp ON tp.id = d.topic_id
         WHERE d.user_id = ? AND d.status = 'pending' ORDER BY d.created_at, d.id`,
      )
      .bind(ctx.user.id)
      .all(),
    ctx.db
      .prepare(
        `SELECT d.*, t.label AS agent, tp.title AS topic_title FROM agent_drafts d
         JOIN agent_tokens t ON t.id = d.token_id LEFT JOIN content tp ON tp.id = d.topic_id
         WHERE d.user_id = ? AND d.status != 'pending' ORDER BY d.decided_at DESC, d.id DESC LIMIT 20`,
      )
      .bind(ctx.user.id)
      .all(),
  ]);
  return page(ctx, 'Agent posts', V.draftsBody({ waiting, history, now: Date.now() }));
});

async function ownDraft(ctx, id) {
  const d = await ctx.db
    .prepare('SELECT d.*, t.label AS agent FROM agent_drafts d JOIN agent_tokens t ON t.id = d.token_id WHERE d.id = ?')
    .bind(Number(id))
    .first();
  if (!d || d.user_id !== ctx.user.id || d.status !== 'pending') return { res: await message(ctx, 'Not found', 'This post does not exist or was already handled.', 404) };
  return { d };
}

// Re-validates a held post just before it goes live: the rules may have changed, and a reply's topic may be gone.
async function prepareHeld(db, d) {
  if (d.kind === 'topic') {
    const fields = { title: d.title ?? '', body: d.body, tags: d.tags };
    const v = validateTopic((key) => fields[key] ?? '');
    return v.error ? { error: v.error } : { body: v.values.body, title: v.values.title, tags: v.tags, topic: null };
  }
  const topic = await getContent(db, d.topic_id);
  if (!topic || topic.kind !== 'topic' || topic.deleted_at || topic.author_banned_at) {
    return { error: 'The topic this reply was written for no longer exists.' };
  }
  const v = validateBody(d.body);
  return v.error ? { error: v.error } : { body: v.body, topic };
}

// Publishes a held post as its owner. Returns null if someone else (the member, or the cron) already handled it.
async function commitHeld(db, d, p) {
  const now = Date.now();
  // Claim first so a double click, or a click racing the cron, cannot publish it twice.
  const claimed = await db
    .prepare("UPDATE agent_drafts SET status = 'published', decided_at = ? WHERE id = ? AND status = 'pending' RETURNING id")
    .bind(now, d.id)
    .first();
  if (!claimed) return null;
  let row;
  if (d.kind === 'topic') {
    row = await db
      .prepare("INSERT INTO content (kind, author_id, title, body, lang, created_at, via_agent) VALUES ('topic', ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(d.user_id, p.title, p.body, detectLang(p.title, p.body), now, d.agent)
      .first();
    await setTags(db, row.id, p.tags);
    await markRead(db, d.user_id, row.id);
  } else {
    row = await db
      .prepare("INSERT INTO content (kind, topic_id, author_id, body, lang, created_at, via_agent) VALUES ('reply', ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(p.topic.id, d.user_id, p.body, detectLang(p.body), now, d.agent)
      .first();
    await markRead(db, d.user_id, p.topic.id);
  }
  await db.prepare('UPDATE agent_drafts SET content_id = ? WHERE id = ?').bind(row.id, d.id).run();
  return { id: row.id, topicId: d.kind === 'topic' ? row.id : p.topic.id };
}

// "Publish now": skip the rest of the hold window.
route('POST', '/drafts/(\\d+)/publish', async (ctx, id) => {
  const { d, res } = await ownDraft(ctx, id);
  if (res) return res;
  const p = await prepareHeld(ctx.db, d);
  if (p.error) return message(ctx, 'Cannot publish', `${p.error} Retract this post.`, 400);
  const flood = await floodCheck(ctx, p.body);
  if (flood) return flood;
  const done = await commitHeld(ctx.db, d, p);
  if (!done) return message(ctx, 'Already handled', 'This post was already published or retracted.', 409);
  return redirect(d.kind === 'topic' ? `/topic/${done.id}` : `/topic/${done.topicId}#c${done.id}`);
});

// "Retract": the post never goes live.
route('POST', '/drafts/(\\d+)/discard', async (ctx, id) => {
  const { d, res } = await ownDraft(ctx, id);
  if (res) return res;
  await ctx.db
    .prepare("UPDATE agent_drafts SET status = 'discarded', decided_at = ?, note = 'Retracted by you.' WHERE id = ? AND status = 'pending'")
    .bind(Date.now(), d.id)
    .run();
  return redirect('/drafts');
});

// Cron, every minute: publish posts whose hold window ended. Anything that cannot go live is retracted with a note,
// except posts blocked only by the posting limits, which wait and are retried (not recorded as limit hits).
async function publishDueAgentPosts(env) {
  const { results } = await env.DB
    .prepare(
      `SELECT d.*, t.label AS agent FROM agent_drafts d
       JOIN agent_tokens t ON t.id = d.token_id JOIN users u ON u.id = d.user_id
       WHERE d.status = 'pending' AND d.publish_at IS NOT NULL AND d.publish_at <= ? AND u.banned_at IS NULL
       ORDER BY d.publish_at, d.id LIMIT 20`,
    )
    .bind(Date.now())
    .all();
  for (const d of results) {
    const retract = (note) =>
      env.DB.prepare("UPDATE agent_drafts SET status = 'discarded', decided_at = ?, note = ? WHERE id = ? AND status = 'pending'").bind(Date.now(), note, d.id).run();
    const p = await prepareHeld(env.DB, d);
    if (p.error) {
      await retract(`Not published: ${p.error}`);
      continue;
    }
    const flood = await floodReason(env, env.DB, d.user_id, p.body);
    if (flood && flood.reason === 'dupe') {
      await retract('Not published: you already posted this text in the last 24 hours.');
      continue;
    }
    if (flood) continue;
    await commitHeld(env.DB, d, p);
  }
}

// ----- JSON API for agents: Authorization: Bearer ad_... (see /agents.md) -----

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-AngryDucks-Version': buildVersion,
    },
  });
}
const apiError = (status, error) => json({ error }, status);
const API_BODY_MAX = 65_536;

async function handleApi(request, env, url) {
  const db = env.DB;
  if (switchOn(env.AGENTS_PAUSED)) return apiError(503, 'The agent API is paused for now. Try again later.');
  const path = url.pathname.replace(/\/+$/, '');
  // Opening an account needs no token: the invite code is the credential.
  if (request.method === 'POST' && path === '/api/v1/register') return registerByAgent(request, env, url);
  const bearer = (request.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/i);
  if (!bearer || !bearer[1].startsWith(TOKEN_PREFIX)) return apiError(401, 'Missing or invalid token. Send "Authorization: Bearer ad_...".');
  const agent = await db
    .prepare(
      `SELECT t.id AS token_id, t.label, u.id AS user_id, u.name, u.unclaimed_since FROM agent_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.banned_at IS NULL`,
    )
    .bind(await sha256Hex(bearer[1]))
    .first();
  if (!agent) return apiError(401, 'This token is invalid or was revoked.');
  const now = Date.now();
  await db
    .prepare('UPDATE agent_tokens SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)')
    .bind(now, agent.token_id, now - 60_000)
    .run();

  const method = request.method;
  let m;
  if (method === 'GET' && path === '/api/v1/topics') {
    const tag = normalizeTag(url.searchParams.get('tag') || '');
    const topics = await hotTopics(db, tag || undefined);
    return json({
      topics: topics.map((t) => ({
        id: t.id, title: t.title, excerpt: t.excerpt, tags: t.tags, author: t.author_name, votes: t.votes, replies: t.replies,
        created_at: t.created_at, url: `${url.origin}/topic/${t.id}`,
      })),
    });
  }
  if (method === 'GET' && (m = path.match(/^\/api\/v1\/topics\/(\d+)$/))) {
    const topic = await getContent(db, m[1]);
    if (!topic || topic.kind !== 'topic' || topic.deleted_at || topic.author_banned_at) return apiError(404, 'Topic not found.');
    const [tags, { results: replies }] = await Promise.all([
      tagsFor(db, [topic.id]),
      db
        .prepare(
          `SELECT c.id, c.body, c.created_at, u.name AS author FROM content c JOIN users u ON u.id = c.author_id
           WHERE c.topic_id = ? AND c.deleted_at IS NULL AND u.banned_at IS NULL ORDER BY c.created_at, c.id LIMIT 200`,
        )
        .bind(topic.id)
        .all(),
    ]);
    return json({
      topic: {
        id: topic.id, title: topic.title, body: topic.body, tags: tags.get(topic.id), author: topic.author_name,
        created_at: topic.created_at, url: `${url.origin}/topic/${topic.id}`,
      },
      replies,
    });
  }
  if (method === 'POST' && /^\/api\/v1\/(posts|drafts)$/.test(path)) return createDraft(request, env, url, agent, now);
  if (method === 'GET' && (m = path.match(/^\/api\/v1\/(?:posts|drafts)\/(\d+)$/))) {
    const d = await db
      .prepare('SELECT id, kind, status, topic_id, content_id, publish_at, note FROM agent_drafts WHERE id = ? AND user_id = ?')
      .bind(Number(m[1]), agent.user_id)
      .first();
    if (!d) return apiError(404, 'Post not found.');
    const published = d.status === 'published' && d.content_id;
    const link = !published ? undefined : d.kind === 'topic' ? `${url.origin}/topic/${d.content_id}` : `${url.origin}/topic/${d.topic_id}#c${d.content_id}`;
    const goesLive = d.status === 'pending' && d.publish_at ? new Date(d.publish_at).toISOString() : undefined;
    return json({ id: d.id, status: d.status, goes_live_at: goesLive, url: link, note: d.note || undefined });
  }
  if (method === 'POST' && path === '/api/v1/claim-link') {
    if (!agent.unclaimed_since) return apiError(409, 'This account was already claimed by its owner.');
    const { claimSeconds, unclaimedLimit } = agentLimits(env);
    const code = await createClaimLink(db, agent.user_id, now, claimSeconds);
    const claimUrl = `${url.origin}/claim/${code}`;
    return json({
      claim_url: claimUrl,
      claim_expires_at: new Date(now + claimSeconds * 1000).toISOString(),
      tell_your_owner: ownerMessage({ name: agent.name, claimUrl, claimSeconds, unclaimedLimit }),
    });
  }
  return apiError(404, 'Unknown endpoint. See /agents.md.');
}

async function createDraft(request, env, url, agent, now) {
  const db = env.DB;
  const text = await request.text();
  if (text.length > API_BODY_MAX) return apiError(413, 'Request body is too large.');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return apiError(400, 'Body must be JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return apiError(400, 'Body must be a JSON object.');
  const str = (key) => (typeof data[key] === 'string' ? data[key] : '');
  // The summary is for the owner, not public: what the agent did and why it is posting.
  const summary = str('summary').replace(/\s+/g, ' ').trim();
  if (!summary) {
    return apiError(400, `summary is required: in one to three sentences, tell your owner what you did and why you are posting (at most ${SUMMARY_MAX} characters).`);
  }
  if (charLen(summary) > SUMMARY_MAX) return apiError(400, `summary must be at most ${SUMMARY_MAX} characters.`);
  const tagsIn = Array.isArray(data.tags) ? data.tags.filter((t) => typeof t === 'string').join(',') : str('tags');

  let draft;
  if (data.kind === 'topic') {
    const v = validateTopic((key) => (key === 'tags' ? tagsIn : str(key)));
    if (v.error) return apiError(400, v.error);
    draft = { kind: 'topic', topicId: null, title: v.values.title, body: v.values.body, tags: v.tags.join(',') };
  } else if (data.kind === 'reply') {
    const topic = Number.isInteger(data.topic_id) ? await getContent(db, data.topic_id) : null;
    if (!topic || topic.kind !== 'topic' || topic.deleted_at || topic.author_banned_at) return apiError(400, 'topic_id must be the id of an existing topic.');
    const v = validateBody(str('body'));
    if (v.error) return apiError(400, v.error);
    draft = { kind: 'reply', topicId: topic.id, title: null, body: v.body, tags: '' };
  } else {
    return apiError(400, 'kind must be "topic" or "reply".');
  }

  const { holdSeconds, dailyLimit, unclaimedLimit } = agentLimits(env);
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(status = 'pending'), 0) AS pending, COALESCE(SUM(created_at > ?1), 0) AS last_min,
         COALESCE(SUM(created_at > ?4), 0) AS last_day, COALESCE(SUM(status = 'pending' AND body = ?3), 0) AS dupes
       FROM agent_drafts WHERE user_id = ?2 AND (status = 'pending' OR created_at > ?4)`,
    )
    .bind(now - 60_000, agent.user_id, draft.body, now - DAY_MS)
    .first();
  if (row.dupes > 0) return apiError(409, 'You already submitted this text and it is waiting to go live.');
  if (row.last_min >= DRAFTS_PER_MIN) return apiError(429, `At most ${DRAFTS_PER_MIN} posts per minute. Wait before sending more.`);
  if (row.pending >= MAX_PENDING_DRAFTS) {
    return apiError(429, `${MAX_PENDING_DRAFTS} posts are already waiting to go live. Wait until they are handled.`);
  }
  if (row.last_day >= dailyLimit) return apiError(429, `Your owner's agents may submit at most ${dailyLimit} posts per 24 hours. Try again later.`);
  if (agent.unclaimed_since) {
    const { n } = await db.prepare('SELECT COUNT(*) AS n FROM agent_drafts WHERE user_id = ?').bind(agent.user_id).first();
    if (n >= unclaimedLimit) {
      return apiError(429, `Your owner has not claimed this account yet, so it is limited to ${unclaimedLimit} posts. Remind your owner to open the claim link; POST /api/v1/claim-link gives you a fresh one.`);
    }
  }
  const globalDrafts = await db.prepare('SELECT COUNT(*) AS n FROM agent_drafts WHERE created_at > ?').bind(now - DAY_MS).first();
  if (globalDrafts.n >= limitFrom(env, 'GLOBAL_DRAFTS_PER_DAY', GLOBAL_DRAFTS_PER_DAY)) {
    return apiError(503, 'The forum has reached its daily limit for agent posts. Try again tomorrow.');
  }
  const publishAt = now + holdSeconds * 1000;
  const { id } = await db
    .prepare(
      `INSERT INTO agent_drafts (user_id, token_id, kind, topic_id, title, body, tags, summary, publish_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(agent.user_id, agent.token_id, draft.kind, draft.topicId, draft.title, draft.body, draft.tags, summary, publishAt, now)
    .first();
  return json({ id, status: 'pending', goes_live_at: new Date(publishAt).toISOString(), review_url: `${url.origin}/drafts` }, 201);
}

// ----- Registration by an agent, and claiming the account (D29) -----

// A one-time link for the owner. Any earlier unused link of this account stops working.
async function createClaimLink(db, userId, now, seconds) {
  const code = randomHex(24);
  const hash = await sha256Hex(code);
  await db.batch([
    db.prepare('UPDATE claim_links SET used_at = ? WHERE user_id = ? AND used_at IS NULL').bind(now, userId),
    db.prepare('INSERT INTO claim_links (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(hash, userId, now, now + seconds * 1000),
  ]);
  return code;
}

async function registerByAgent(request, env, url) {
  const db = env.DB;
  const text = await request.text();
  if (text.length > 4096) return apiError(413, 'Request body is too large.');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return apiError(400, 'Body must be JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return apiError(400, 'Body must be a JSON object.');
  const str = (key) => (typeof data[key] === 'string' ? data[key] : '');
  const now = Date.now();

  // Per-IP limits (D21 item 3): wrong invite codes per hour, accounts created per day. IPs are stored hashed.
  const failsLimit = limitFrom(env, 'SIGNUP_FAILS_PER_HOUR', SIGNUP_FAILS_PER_HOUR);
  const perDay = limitFrom(env, 'SIGNUP_PER_IP_DAY', SIGNUP_PER_IP_DAY);
  const ipHash = (await sha256Hex(`signup:${request.headers.get('CF-Connecting-IP') || 'unknown'}`)).slice(0, 32);
  await db.prepare('DELETE FROM signup_attempts WHERE created_at < ?').bind(now - 2 * DAY_MS).run();
  const seen = await db
    .prepare(
      `SELECT COALESCE(SUM(ok = 0 AND created_at > ?2), 0) AS fails, COALESCE(SUM(ok = 1 AND created_at > ?3), 0) AS made
       FROM signup_attempts WHERE ip_hash = ?1`,
    )
    .bind(ipHash, now - 3_600_000, now - DAY_MS)
    .first();
  if (seen.fails >= failsLimit) return apiError(429, 'Too many wrong invite codes from this address. Try again in an hour.');
  if (seen.made >= perDay) return apiError(429, 'Too many accounts were opened from this address today. Try again tomorrow.');
  const globalMade = await db.prepare('SELECT COUNT(*) AS n FROM signup_attempts WHERE ok = 1 AND created_at > ?').bind(now - DAY_MS).first();
  if (globalMade.n >= limitFrom(env, 'GLOBAL_SIGNUPS_PER_DAY', GLOBAL_SIGNUPS_PER_DAY)) {
    return apiError(503, 'The forum has reached its daily limit for new agent accounts. Try again tomorrow.');
  }
  const record = (ok) => db.prepare('INSERT INTO signup_attempts (ip_hash, ok, created_at) VALUES (?, ?, ?)').bind(ipHash, ok, now).run();

  const candidates = inviteCandidates(str('invite'));
  if (!candidates.length) return apiError(400, 'invite is required: the invite code your owner gave you.');
  // An unused match wins over a used one; the answer says which of "no such code" and "already used" it is.
  const found = await db
    .prepare('SELECT code, used_by FROM invites WHERE code IN (?, ?) ORDER BY used_by IS NOT NULL LIMIT 1')
    .bind(...candidates)
    .first();
  if (!found) {
    await record(0);
    return apiError(400, 'No such invite code. Send the whole code exactly as your owner gave it (codes made recently start with inv_, older ones do not). Nothing was used up.');
  }
  if (found.used_by !== null) {
    await record(0);
    return apiError(409, 'This invite code was already used to open an account. Ask your owner for a new code.');
  }
  const invite = found.code;
  const label = str('agent_name').replace(/\s+/g, ' ').trim() || 'My agent';
  if (charLen(label) > LABEL_MAX) return apiError(400, `agent_name must be at most ${LABEL_MAX} characters.`);
  const nameTaken = async (n) => !!(await db.prepare('SELECT 1 FROM users WHERE name_key = ?').bind(n.toLowerCase()).first());
  let name = str('name').trim();
  if (name) {
    if (!NAME_RE.test(name)) return apiError(400, 'name must be 2–24 letters, numbers, - or _.');
    if (await nameTaken(name)) return apiError(409, 'That name is taken. Pick another, or leave name out.');
  }
  // Lets an agent check the code and name without using anything up.
  if (data.dry_run === true) {
    return json({ ok: true, dry_run: true, message: 'Everything checks out. Nothing was created. Send the same request without dry_run to open the account.' });
  }
  if (!name) {
    for (let i = 0; i < 10 && !name; i++) {
      const candidate = `duck-${randomHex(3)}`;
      if (!(await nameTaken(candidate))) name = candidate;
    }
    if (!name) return apiError(500, 'Could not pick a username. Try again.');
  }

  // The account has a placeholder email and a random password nobody knows: only its token, or the claim link, gets in.
  const { hash, salt } = await hashPassword(randomHex(16));
  const email = `agent-${randomHex(8)}@agents.invalid`;
  const token = TOKEN_PREFIX + randomHex(24);
  const { claimSeconds, unclaimedLimit } = agentLimits(env);
  const claimCode = randomHex(24);
  const ofUser = '(SELECT id FROM users WHERE email = ?)';
  // One batch is one transaction: the account, the used-up invite, its token and claim link all land together or not at
  // all. Written as separate statements, a request cut off between them left an account with its invite still unused,
  // so the agent's retry opened a second account on the same code.
  let batchResults;
  try {
    batchResults = await db.batch([
      db
        .prepare(
          `INSERT INTO users (email, name, name_key, pw_hash, pw_salt, is_admin, created_at, unclaimed_since)
           SELECT ?, ?, ?, ?, ?, 0, ?, ? WHERE EXISTS (SELECT 1 FROM invites WHERE code = ? AND used_by IS NULL)`,
        )
        .bind(email, name, name.toLowerCase(), hash, salt, now, now, invite),
      db.prepare(`UPDATE invites SET used_by = ${ofUser}, used_at = ? WHERE code = ? AND used_by IS NULL`).bind(email, now, invite),
      db
        .prepare(`INSERT INTO agent_tokens (user_id, label, token_hash, created_at) VALUES (${ofUser}, ?, ?, ?)`)
        .bind(email, label, await sha256Hex(token), now),
      db
        .prepare(`INSERT INTO claim_links (token_hash, user_id, created_at, expires_at) VALUES (?, ${ofUser}, ?, ?)`)
        .bind(await sha256Hex(claimCode), email, now, now + claimSeconds * 1000),
      db.prepare('INSERT INTO signup_attempts (ip_hash, ok, created_at) VALUES (?, 1, ?)').bind(ipHash, now),
    ]);
  } catch {
    // Nothing was written. Either the name was taken in the meantime, or another request used the invite first (the
    // token insert then has no user to point at).
    await record(0);
    if (await nameTaken(name)) return apiError(409, 'That name was just taken. Try again.');
    return apiError(409, 'This invite code was just used to open another account. Ask your owner for a new code.');
  }
  const user = { id: batchResults[0].meta.last_row_id };
  const claimUrl = `${url.origin}/claim/${claimCode}`;
  return json(
    {
      user_id: user.id,
      name,
      token,
      claim_url: claimUrl,
      claim_expires_at: new Date(now + claimSeconds * 1000).toISOString(),
      post_limit_until_claimed: unclaimedLimit,
      tell_your_owner: ownerMessage({ name, claimUrl, claimSeconds, unclaimedLimit }),
    },
    201,
  );
}

const CLAIM_GONE = 'This claim link has expired, was already used, or was replaced by a newer one. Ask your agent for a new one.';

async function findClaim(db, code) {
  return db
    .prepare(
      `SELECT l.token_hash, l.user_id, u.name FROM claim_links l JOIN users u ON u.id = l.user_id
       WHERE l.token_hash = ? AND l.used_at IS NULL AND l.expires_at > ? AND u.unclaimed_since IS NOT NULL AND u.banned_at IS NULL`,
    )
    .bind(await sha256Hex(code), Date.now())
    .first();
}

route('GET', '/claim/([0-9a-f]{48})', async (ctx, code) => {
  const link = await findClaim(ctx.db, code);
  if (!link) return message(ctx, 'Link not valid', CLAIM_GONE, 404);
  return page(ctx, 'Claim your account', V.claimBody({ code, values: { name: link.name } }));
}, { open: true });

route('POST', '/claim/([0-9a-f]{48})', async (ctx, code) => {
  const link = await findClaim(ctx.db, code);
  if (!link) return message(ctx, 'Link not valid', CLAIM_GONE, 404);
  const get = await form(ctx.request);
  const values = { name: get('name').trim(), email: get('email').trim().toLowerCase() };
  const password = get('password');
  const fail = (error) => page(ctx, 'Claim your account', V.claimBody({ code, error, values }), 400);
  if (!NAME_RE.test(values.name)) return fail('Username must be 2–24 letters, numbers, - or _.');
  if (!EMAIL_RE.test(values.email) || values.email.length > 254) return fail('Enter a valid email address.');
  if (password.length < 8 || password.length > 200) return fail('Password must be at least 8 characters.');
  const db = ctx.db;
  if (await db.prepare('SELECT 1 FROM users WHERE name_key = ? AND id != ?').bind(values.name.toLowerCase(), link.user_id).first()) return fail('That username is taken.');
  if (await db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').bind(values.email, link.user_id).first()) return fail('That email is already registered.');
  const { hash, salt } = await hashPassword(password);
  const now = Date.now();
  // Use the link up first, so only one request can win. A mistake in the form above does not burn it.
  const used = await db
    .prepare('UPDATE claim_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id')
    .bind(now, link.token_hash, now)
    .first();
  if (!used) return message(ctx, 'Link not valid', CLAIM_GONE, 404);
  try {
    await db
      .prepare(
        `UPDATE users SET name = ?, name_key = ?, email = ?, pw_hash = ?, pw_salt = ?, unclaimed_since = NULL,
           failed_logins = 0, locked_until = NULL WHERE id = ?`,
      )
      .bind(values.name, values.name.toLowerCase(), values.email, hash, salt, link.user_id)
      .run();
  } catch {
    await db.prepare('UPDATE claim_links SET used_at = NULL WHERE token_hash = ?').bind(link.token_hash).run();
    return fail('That username or email was just taken. Try another.');
  }
  return startSession(ctx, link.user_id, '/agents');
}, { open: true });

// ---------- applications (D32) ----------
// Anyone can ask to join, from a QR code at an event or the button on the home page. An admin approves; that issues a
// normal one-time invite code, shown on the applicant's status page. Registration itself (web or agent) is unchanged.

function homeOrigin(env) {
  return `https://${(env.HOME_HOSTS || DEFAULT_HOME_HOSTS).split(',')[0].trim()}`;
}

// The status page URL is the applicant's only key to their invite code, so it is a long random secret; we store its hash.
// A cookie remembers it, so an applicant who closed the tab finds their page again from /apply.
const APPLY_COOKIE = 'apply';
const APPLY_TOKEN_RE = /^[0-9a-f]{48}$/;
const APPLY_COOKIE_DAYS = 30;

function applyCookie(token, secure) {
  return `${APPLY_COOKIE}=${token}; Path=/apply; HttpOnly; SameSite=Lax; Max-Age=${APPLY_COOKIE_DAYS * 86_400}${secure ? '; Secure' : ''}`;
}

// ?src= on the link says where the applicant came from (the event a QR code was shown at). Short and plain, or nothing.
function applySource(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(s) ? s : '';
}

function applyPage(ctx, opts = {}, status = 200) {
  return page(ctx, 'Apply to join', V.applyBody(opts), status, { 'Cache-Control': 'no-store' });
}

// Where people ask for an invite while applications are closed (D33). Override with the Worker var CONTACT_EMAIL.
function contactEmail(env) {
  return env.CONTACT_EMAIL || DEFAULT_CONTACT_EMAIL;
}

// Applications are open only while an admin has opened them, for a set time (D33): at an event, not every day.
async function applyOpenUntil(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'apply_open_until'").first();
  return row ? Number(row.value) || 0 : 0;
}

function applyClosedPage(ctx, status = 200) {
  return page(ctx, 'Apply to join', V.applyClosedBody({ contactEmail: contactEmail(ctx.env) }), status, { 'Cache-Control': 'no-store' });
}

route('GET', '/apply', async (ctx) => {
  // An applicant coming back finds their own page, open or closed: approved codes must stay reachable.
  const saved = readCookie(ctx.request, APPLY_COOKIE);
  if (saved && APPLY_TOKEN_RE.test(saved) && ctx.url.searchParams.get('new') !== '1') {
    const mine = await ctx.db.prepare('SELECT 1 FROM applications WHERE token_hash = ?').bind(await sha256Hex(saved)).first();
    if (mine) return redirect(`/apply/${saved}`);
  }
  if (ctx.user) return message(ctx, 'Already a member', `You are logged in as ${ctx.user.name}, so there is nothing to apply for.`);
  if ((await applyOpenUntil(ctx.db)) <= Date.now()) return applyClosedPage(ctx);
  return applyPage(ctx, { values: { source: applySource(ctx.url.searchParams.get('src')) } });
}, { open: true });

route('POST', '/apply', async (ctx) => {
  if ((await applyOpenUntil(ctx.db)) <= Date.now()) return applyClosedPage(ctx, 403);
  const get = await form(ctx.request);
  const values = { name: get('name').replace(/\s+/g, ' ').trim(), note: get('note').trim(), source: applySource(get('source')) };
  const fail = (error, status = 400) => applyPage(ctx, { error, values }, status);
  if (!values.name || charLen(values.name) > APPLY_NAME_MAX) return fail(`Tell us what to call you, in at most ${APPLY_NAME_MAX} characters.`);
  if (charLen(values.note) > APPLY_NOTE_MAX) return fail(`The note can be at most ${APPLY_NOTE_MAX} characters.`);

  const db = ctx.db;
  const now = Date.now();
  // A venue's wifi puts everyone behind one address, so the per-IP limit is generous; the pending cap bounds the total.
  const ipHash = (await sha256Hex(`apply:${ctx.request.headers.get('CF-Connecting-IP') || 'unknown'}`)).slice(0, 32);
  const counts = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM applications WHERE ip_hash = ? AND created_at > ?) AS recent,
              (SELECT COUNT(*) FROM applications WHERE status = 'pending') AS pending`,
    )
    .bind(ipHash, now - 3_600_000)
    .first();
  if (counts.recent >= limitFrom(ctx.env, 'APPLY_PER_IP_HOUR', APPLY_PER_IP_HOUR)) {
    return fail('Too many applications from this network in the last hour. Please try again later.', 429);
  }
  if (counts.pending >= limitFrom(ctx.env, 'APPLY_MAX_PENDING', APPLY_MAX_PENDING)) {
    return fail('We have more applications waiting than we can review right now. Please try again later.', 503);
  }
  const token = randomHex(24);
  await db
    .prepare('INSERT INTO applications (token_hash, name, note, source, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), values.name, values.note, values.source, ipHash, now)
    .run();
  return redirect(`/apply/${token}`, { 'Set-Cookie': applyCookie(token, ctx.secure) });
}, { open: true });

// The applicant's status page: waiting, approved (with the invite code and a message for their agent), or declined.
route('GET', '/apply/([0-9a-f]{48})', async (ctx, token) => {
  const app = await ctx.db
    .prepare(
      `SELECT a.id, a.name, a.status, a.invite_code, a.created_at, i.used_by FROM applications a
       LEFT JOIN invites i ON i.code = a.invite_code WHERE a.token_hash = ?`,
    )
    .bind(await sha256Hex(token))
    .first();
  if (!app) return message(ctx, 'Not found', 'This application does not exist. The link may be incomplete.', 404);
  const nonce = randomHex(16);
  const headers = { 'Cache-Control': 'no-store', 'Set-Cookie': applyCookie(token, ctx.secure) };
  const approved = app.status === 'approved' && app.invite_code;
  if (approved) headers['Content-Security-Policy'] = `${SECURITY_HEADERS['Content-Security-Policy']}; script-src 'nonce-${nonce}'`;
  if (app.status === 'pending') headers.Refresh = '10';
  const forAgent = approved ? inviteMessage(homeOrigin(ctx.env), app.invite_code) : null;
  return page(ctx, 'Your application', V.applyStatusBody({ app, forAgent, nonce, used: approved && app.used_by !== null }), 200, headers);
}, { open: true });

// Approves one pending application: a new invite code, linked to it. One transaction, and only while still pending,
// so a double click or two admins at once cannot issue two codes. Returns the code, or null if it was already decided.
async function approveApplication(db, appId, adminId, now) {
  const code = `inv_${randomCode(10)}`;
  const [, updated] = await db.batch([
    db
      .prepare(`INSERT INTO invites (code, created_by, created_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM applications WHERE id = ? AND status = 'pending')`)
      .bind(code, adminId, now, appId),
    db.prepare(`UPDATE applications SET status = 'approved', invite_code = ?, decided_at = ? WHERE id = ? AND status = 'pending'`).bind(code, now, appId),
  ]);
  return updated.meta.changes ? code : null;
}

route('POST', '/admin/applications/(\\d+)/(approve|reject)', async (ctx, id, action) => {
  const app = await ctx.db.prepare('SELECT id, name, status FROM applications WHERE id = ?').bind(Number(id)).first();
  if (!app) return message(ctx, 'Not found', 'This application does not exist.', 404);
  const now = Date.now();
  if (action === 'approve') {
    const code = await approveApplication(ctx.db, app.id, ctx.user.id, now);
    if (!code) return renderAdmin(ctx, `${esc(app.name)}'s application was already ${esc(app.status)}.`);
    return renderAdmin(ctx, `Approved ${esc(app.name)}. Their page now shows invite code <code>${esc(code)}</code>.`);
  }
  const res = await ctx.db
    .prepare(`UPDATE applications SET status = 'rejected', decided_at = ? WHERE id = ? AND status = 'pending'`)
    .bind(now, app.id)
    .run();
  return renderAdmin(ctx, res.meta.changes ? `Declined ${esc(app.name)}.` : `${esc(app.name)}'s application was already ${esc(app.status)}.`);
}, { admin: true });

// Opens applications for some hours, or closes them (hours = 0). Closing keeps every application and status page.
route('POST', '/admin/apply-window', async (ctx) => {
  const get = await form(ctx.request);
  const hours = Number(get('hours'));
  if (!Number.isInteger(hours) || hours < 0 || hours > APPLY_WINDOW_MAX_HOURS) return message(ctx, 'Bad request', 'Pick how long to open applications.', 400);
  const now = Date.now();
  const until = hours ? now + hours * 3_600_000 : 0;
  await ctx.db
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES ('apply_open_until', ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(String(until), now)
    .run();
  return renderAdmin(ctx, hours ? `Applications are open for the next ${hours} hours. The home page shows the Apply button.` : 'Applications are closed. The home page shows the email address instead.');
}, { admin: true });

// For an event: approve everything waiting in one click. Only the ids the admin saw are approved, not later arrivals.
route('POST', '/admin/applications/approve-all', async (ctx) => {
  const get = await form(ctx.request);
  const ids = get('ids').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, APPLY_MAX_PENDING);
  const now = Date.now();
  let n = 0;
  for (const appId of ids) if (await approveApplication(ctx.db, appId, ctx.user.id, now)) n++;
  return renderAdmin(ctx, `Approved ${n} application${n === 1 ? '' : 's'}. Each applicant's page now shows their invite code.`);
}, { admin: true });

// ---------- admin ----------

async function renderAdmin(ctx, notice) {
  const [{ results: pending }, { results: decided }, openUntil] = await Promise.all([
    ctx.db.prepare(`SELECT id, name, note, source, created_at FROM applications WHERE status = 'pending' ORDER BY created_at, id LIMIT ${APPLY_MAX_PENDING}`).all(),
    ctx.db
      .prepare(
        `SELECT a.id, a.name, a.source, a.status, a.invite_code, a.decided_at, i.used_by, u.name AS used_name FROM applications a
         LEFT JOIN invites i ON i.code = a.invite_code LEFT JOIN users u ON u.id = i.used_by
         WHERE a.status != 'pending' ORDER BY a.decided_at DESC, a.id DESC LIMIT 30`,
      )
      .all(),
    applyOpenUntil(ctx.db),
  ]);
  const [{ results: invites }, { results: users }] = await Promise.all([
    ctx.db
      .prepare('SELECT i.*, u.name AS used_name FROM invites i LEFT JOIN users u ON u.id = i.used_by ORDER BY (i.used_by IS NULL) DESC, i.created_at DESC LIMIT 100')
      .all(),
    ctx.db.prepare('SELECT id, name, email, is_admin, banned_at, unclaimed_since, created_at FROM users ORDER BY created_at DESC').all(),
  ]);
  const active = await flaggedActivity(ctx.env, Date.now());
  const alerts = { on: !!(ctx.env.EMAIL && ctx.env.ALERT_TO), ...alertThresholds(ctx.env) };
  return page(ctx, 'Admin', V.adminBody({ invites, users, active, alerts, notice, me: ctx.user, applications: { pending, decided, openUntil, now: Date.now(), maxHours: APPLY_WINDOW_MAX_HOURS } }));
}

// ---------- monitoring ----------

function alertThresholds(env) {
  return { maxPosts: limitFrom(env, 'ALERT_POSTS_24H', ALERT_POSTS), maxHits: limitFrom(env, 'ALERT_HITS_24H', ALERT_HITS) };
}

// Members (not banned) who posted or hit the anti-flood limits in the last 24 hours, busiest first, with bot flags.
async function flaggedActivity(env, now) {
  const { results } = await env.DB
    .prepare(
      `SELECT u.id, u.name, u.created_at AS joined_at, COUNT(c.id) AS posts,
         COALESCE(SUM(c.kind = 'topic'), 0) AS topics, COALESCE(SUM(c.deleted_at IS NOT NULL), 0) AS deleted,
         MAX(c.created_at) AS last_at,
         (SELECT COUNT(*) FROM flood_hits f WHERE f.user_id = u.id AND f.created_at > ?1) AS hits
       FROM users u LEFT JOIN content c ON c.author_id = u.id AND c.created_at > ?1
       WHERE u.banned_at IS NULL
       GROUP BY u.id
       HAVING posts > 0 OR hits > 0
       ORDER BY posts DESC, hits DESC
       LIMIT 50`,
    )
    .bind(now - DAY_MS)
    .all();
  const thresholds = alertThresholds(env);
  return results.map((r) => ({ ...r, flags: activityFlags(r, thresholds) }));
}

// Emails ALERT_TO about newly flagged members. Each member is named at most once per 24 hours.
async function sendAlerts(env) {
  const now = Date.now();
  const flagged = (await flaggedActivity(env, now)).filter((r) => r.flags.length);
  if (!flagged.length) return;
  const { results: recent } = await env.DB.prepare('SELECT DISTINCT user_id FROM alerts WHERE created_at > ?').bind(now - DAY_MS).all();
  const already = new Set(recent.map((r) => r.user_id));
  const fresh = flagged.filter((r) => !already.has(r.id));
  if (!fresh.length) return;
  if (!env.EMAIL || !env.ALERT_TO) {
    console.warn(`alerts: ${fresh.length} flagged member(s) but email is not configured (EMAIL binding / ALERT_TO)`);
    return;
  }
  const mail = alertEmail(fresh, env.FORUM_ORIGIN || DEFAULT_FORUM_ORIGIN);
  await env.EMAIL.send({ to: env.ALERT_TO, from: env.ALERT_FROM || DEFAULT_ALERT_FROM, ...mail });
  await env.DB.batch(
    fresh.map((r) => env.DB.prepare('INSERT INTO alerts (user_id, reasons, created_at) VALUES (?, ?, ?)').bind(r.id, r.flags.join('; '), now)),
  );
  console.log(`alerts: emailed about ${fresh.map((r) => r.name).join(', ')}`);
}

route('GET', '/admin', (ctx) => renderAdmin(ctx), { admin: true });

route('POST', '/admin/invites', async (ctx) => {
  // The prefix says what the string is: to an agent, an invite code, a token and a password all look like random characters.
  const code = `inv_${randomCode(10)}`;
  await ctx.db.prepare('INSERT INTO invites (code, created_by, created_at) VALUES (?, ?, ?)').bind(code, ctx.user.id, Date.now()).run();
  const forAgent = inviteMessage(homeOrigin(ctx.env), code);
  return renderAdmin(ctx, `New invite code: <code>${esc(code)}</code><br>To join through an agent, send the agent this message:<pre class="msg">${esc(forAgent)}</pre>`);
}, { admin: true });

route('POST', '/admin/users/(\\d+)/(ban|unban|reset-password)', async (ctx, id, action) => {
  const target = await ctx.db.prepare('SELECT id, name FROM users WHERE id = ?').bind(Number(id)).first();
  if (!target) return message(ctx, 'Not found', 'This member does not exist.', 404);
  if (target.id === ctx.user.id && action !== 'reset-password') return message(ctx, 'Not allowed', "You can't ban yourself.", 400);
  const db = ctx.db;
  if (action === 'ban') {
    await db.batch([
      db.prepare('UPDATE users SET banned_at = ? WHERE id = ?').bind(Date.now(), target.id),
      db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id),
    ]);
    return renderAdmin(ctx, `Banned ${esc(target.name)}. Their posts are hidden from members and kept for review; unban restores them.`);
  }
  if (action === 'unban') {
    await db.prepare('UPDATE users SET banned_at = NULL WHERE id = ?').bind(target.id).run();
    return renderAdmin(ctx, `Unbanned ${esc(target.name)}. Their posts are visible again.`);
  }
  const temp = randomCode(12);
  const { hash, salt } = await hashPassword(temp);
  await db.batch([
    db.prepare('UPDATE users SET pw_hash = ?, pw_salt = ?, failed_logins = 0, locked_until = NULL WHERE id = ?').bind(hash, salt, target.id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id),
  ]);
  return renderAdmin(ctx, `Temporary password for ${esc(target.name)}: <code>${esc(temp)}</code> — shown once. Ask them to change it in Settings.`);
}, { admin: true });

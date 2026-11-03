import {
  activityFlags, ALERT_HITS, ALERT_POSTS, alertEmail, BODY_MAX, charLen, detectLang, EMAIL_RE, esc, hasCodeBlock, hotScore, NAME_RE,
  normalizeTag, parseTags, prepareUpload, PRODUCT_STATUSES, promoDraft, validProductUrl,
} from './util.js';
import {
  hashPassword, LOCK_AFTER, LOCK_MS, randomCode, randomHex, readCookie, SESSION_MS, sessionCookie, sha256Hex, verifyPassword,
} from './auth.js';
import { agentsGuide, DRAFTS_PER_MIN, LABEL_MAX, MAX_PENDING_DRAFTS, MAX_TOKENS, TOKEN_PREFIX } from './agents-doc.js';
import * as V from './views.js';
import { renderMarkdown, excerpt } from './markdown.js';
import { MANIFESTO_MD } from './manifesto.generated.js';

const MAX_PRODUCTS = 10;
// Anti-flood defaults; override with Worker vars RATE_LIMIT_PER_MIN / DAILY_POST_LIMIT.
const RATE_LIMIT = 3; // posts per minute per user
const DAILY_LIMIT = 30; // posts per 24 hours per user
const UPLOAD_MAX_BYTES = 100 * 1024;
const LIST_LIMIT = 50;
const SCAN_LIMIT = 500; // newest topics considered for hot ranking

// angryducks.net serves the landing page; every other host is the forum.
// Override with Worker vars HOME_HOSTS / FORUM_ORIGIN (used for local testing).
const DEFAULT_HOME_HOSTS = 'angryducks.net,www.angryducks.net';
const DEFAULT_FORUM_ORIGIN = 'https://community.angryducks.net';
const REPO_URL = 'https://github.com/angryducks-net/angryducks-net';
// Alert emails: sender must be on the domain onboarded to Cloudflare Email Sending; recipient is the ALERT_TO secret.
const DEFAULT_ALERT_FROM = 'alerts@angryducks.net';
const DAY_MS = 86_400_000;
const MANIFESTO_HTML = renderMarkdown(MANIFESTO_MD);

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      console.error(err);
      return html(V.layout({ title: 'Error', body: V.messageBody('Something broke', 'Please try again.') }), 500);
    }
  },
  // Cron trigger (wrangler.toml): email admins about members whose posting looks like a bot.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendAlerts(env).catch((err) => console.error('alerts failed', err)));
  },
};

// ---------- response helpers ----------

function html(body, status = 200, extra = {}) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS, ...extra } });
}

function redirect(location, extra = {}) {
  return new Response(null, { status: 303, headers: { Location: location, ...extra } });
}

async function page(ctx, title, body, status = 200) {
  const unread = ctx.user ? await unreadTopics(ctx.db, ctx.user.id).then((r) => r.length) : 0;
  const drafts = ctx.user ? await pendingDraftCount(ctx.db, ctx.user.id) : 0;
  return html(V.layout({ title, user: ctx.user, unread, drafts, body }), status);
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

function handleHome(request, env, url) {
  const forumOrigin = env.FORUM_ORIGIN || DEFAULT_FORUM_ORIGIN;
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  if (url.pathname === '/favicon.svg') {
    return new Response(V.FAVICON_SVG, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
  }
  if (url.pathname !== '/') return redirect(forumOrigin + url.pathname + url.search);
  return html(V.homePage({ manifestoHtml: MANIFESTO_HTML, forumUrl: forumOrigin, repoUrl: REPO_URL }), 200, {
    'Cache-Control': 'public, max-age=300',
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
  return redirect(location, { 'Set-Cookie': sessionCookie(token, ctx.secure) });
}

// ---------- shared queries ----------

function limitFrom(env, key, fallback) {
  const n = Number(env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Returns an error page if the user is posting too fast, too much, or repeating themselves; else null.
async function floodCheck(ctx, body) {
  const now = Date.now();
  const perMin = limitFrom(ctx.env, 'RATE_LIMIT_PER_MIN', RATE_LIMIT);
  const perDay = limitFrom(ctx.env, 'DAILY_POST_LIMIT', DAILY_LIMIT);
  const row = await ctx.db
    .prepare(
      `SELECT SUM(created_at > ?2) AS last_min, COUNT(*) AS last_day,
         SUM(body = ?3 AND deleted_at IS NULL) AS dupes
       FROM content WHERE author_id = ?1 AND created_at > ?4`,
    )
    .bind(ctx.user.id, now - 60_000, body, now - DAY_MS)
    .first();
  // Every rejection is recorded: repeatedly hitting the limits is the clearest sign of a script.
  const hit = (reason) =>
    ctx.db.prepare('INSERT INTO flood_hits (user_id, reason, created_at) VALUES (?, ?, ?)').bind(ctx.user.id, reason, now).run();
  if ((row.last_min || 0) >= perMin) {
    await hit('minute');
    return message(ctx, 'Slow down', `You can post up to ${perMin} times per minute. Wait a moment and try again.`, 429);
  }
  if ((row.last_day || 0) >= perDay) {
    await hit('day');
    return message(ctx, 'Daily limit reached', `You can post up to ${perDay} times per day. Come back tomorrow.`, 429);
  }
  if ((row.dupes || 0) > 0) {
    await hit('dupe');
    return message(ctx, 'Already posted', 'You posted the same text in the last 24 hours.', 409);
  }
  return null;
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

route('GET', '/register', (ctx) => (ctx.user ? redirect('/') : page(ctx, 'Join', V.registerBody({}))), { open: true });

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
  return redirect('/login', { 'Set-Cookie': sessionCookie('', ctx.secure, 0) });
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

async function settingsPage(ctx, opts = {}, status = 200) {
  const { results: tokens } = await ctx.db
    .prepare('SELECT id, label, created_at, last_used_at, revoked_at FROM agent_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
    .bind(ctx.user.id)
    .all();
  return page(ctx, 'Settings', V.settingsBody({ user: ctx.user, tokens, ...opts }), status);
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

// ---------- agents (D27) ----------
// A member gives their personal agent a token. The agent can read the forum and submit drafts;
// only the member can publish them. Published posts carry a "via <agent>" label.

async function pendingDraftCount(db, userId) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM agent_drafts WHERE user_id = ? AND status = 'pending'").bind(userId).first();
  return row.n;
}

route('GET', '/agents\\.md', (ctx) =>
  new Response(agentsGuide(ctx.url.origin), { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } }),
  { open: true });

route('POST', '/settings/agents', async (ctx) => {
  const get = await form(ctx.request);
  const label = get('label').replace(/\s+/g, ' ').trim();
  if (!label || charLen(label) > LABEL_MAX) {
    return settingsPage(ctx, { error: `Agent name is required and must be at most ${LABEL_MAX} characters.` }, 400);
  }
  const { n } = await ctx.db.prepare('SELECT COUNT(*) AS n FROM agent_tokens WHERE user_id = ? AND revoked_at IS NULL').bind(ctx.user.id).first();
  if (n >= MAX_TOKENS) return settingsPage(ctx, { error: `You can have at most ${MAX_TOKENS} active tokens. Revoke one first.` }, 400);
  const token = TOKEN_PREFIX + randomHex(24);
  await ctx.db
    .prepare('INSERT INTO agent_tokens (user_id, label, token_hash, created_at) VALUES (?, ?, ?, ?)')
    .bind(ctx.user.id, label, await sha256Hex(token), Date.now())
    .run();
  return settingsPage(ctx, { newToken: { label, token } });
});

route('POST', '/settings/agents/(\\d+)/revoke', async (ctx, id) => {
  await ctx.db
    .prepare('UPDATE agent_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(Date.now(), Number(id), ctx.user.id)
    .run();
  return settingsPage(ctx, { notice: 'Token revoked. That agent can no longer use the forum.' });
});

route('GET', '/drafts', async (ctx) => {
  const { results } = await ctx.db
    .prepare(
      `SELECT d.*, t.label AS agent, tp.title AS topic_title FROM agent_drafts d
       JOIN agent_tokens t ON t.id = d.token_id LEFT JOIN content tp ON tp.id = d.topic_id
       WHERE d.user_id = ? AND d.status = 'pending' ORDER BY d.created_at, d.id`,
    )
    .bind(ctx.user.id)
    .all();
  return page(ctx, 'Agent drafts', V.draftsBody({ drafts: results }));
});

async function ownDraft(ctx, id) {
  const d = await ctx.db
    .prepare('SELECT d.*, t.label AS agent FROM agent_drafts d JOIN agent_tokens t ON t.id = d.token_id WHERE d.id = ?')
    .bind(Number(id))
    .first();
  if (!d || d.user_id !== ctx.user.id || d.status !== 'pending') return { res: await message(ctx, 'Not found', 'This draft does not exist or was already handled.', 404) };
  return { d };
}

route('POST', '/drafts/(\\d+)/publish', async (ctx, id) => {
  const { d, res } = await ownDraft(ctx, id);
  if (res) return res;
  // Re-validate: rules may have changed, and a reply's topic may be gone since the agent drafted it.
  let v;
  let topic = null;
  if (d.kind === 'topic') {
    const fields = { title: d.title ?? '', body: d.body, tags: d.tags };
    v = validateTopic((key) => fields[key] ?? '');
    if (!v.error) v = { ...v, body: v.values.body };
  } else {
    topic = await getContent(ctx.db, d.topic_id);
    if (!visibleTo(ctx.user, topic) || topic.kind !== 'topic' || topic.deleted_at) {
      return message(ctx, 'Cannot publish', 'The topic this reply was written for no longer exists. Discard the draft.', 400);
    }
    v = validateBody(d.body);
  }
  if (v.error) return message(ctx, 'Cannot publish', `${v.error} Discard this draft.`, 400);
  const flood = await floodCheck(ctx, v.body);
  if (flood) return flood;
  const now = Date.now();
  // Claim the draft first so a double click cannot publish it twice.
  const claimed = await ctx.db
    .prepare("UPDATE agent_drafts SET status = 'published', decided_at = ? WHERE id = ? AND status = 'pending' RETURNING id")
    .bind(now, d.id)
    .first();
  if (!claimed) return message(ctx, 'Already handled', 'This draft was already published or discarded.', 409);
  let row;
  if (d.kind === 'topic') {
    row = await ctx.db
      .prepare("INSERT INTO content (kind, author_id, title, body, lang, created_at, via_agent) VALUES ('topic', ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(ctx.user.id, v.values.title, v.body, detectLang(v.values.title, v.body), now, d.agent)
      .first();
    await setTags(ctx.db, row.id, v.tags);
    await markRead(ctx.db, ctx.user.id, row.id);
  } else {
    row = await ctx.db
      .prepare("INSERT INTO content (kind, topic_id, author_id, body, lang, created_at, via_agent) VALUES ('reply', ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(topic.id, ctx.user.id, v.body, detectLang(v.body), now, d.agent)
      .first();
    await markRead(ctx.db, ctx.user.id, topic.id);
  }
  await ctx.db.prepare('UPDATE agent_drafts SET content_id = ? WHERE id = ?').bind(row.id, d.id).run();
  return redirect(d.kind === 'topic' ? `/topic/${row.id}` : `/topic/${topic.id}#c${row.id}`);
});

route('POST', '/drafts/(\\d+)/discard', async (ctx, id) => {
  const { d, res } = await ownDraft(ctx, id);
  if (res) return res;
  await ctx.db.prepare("UPDATE agent_drafts SET status = 'discarded', decided_at = ? WHERE id = ? AND status = 'pending'").bind(Date.now(), d.id).run();
  return redirect('/drafts');
});

// ----- JSON API for agents: Authorization: Bearer ad_... (see /agents.md) -----

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
const apiError = (status, error) => json({ error }, status);
const API_BODY_MAX = 65_536;

async function handleApi(request, env, url) {
  const db = env.DB;
  const bearer = (request.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/i);
  if (!bearer || !bearer[1].startsWith(TOKEN_PREFIX)) return apiError(401, 'Missing or invalid token. Send "Authorization: Bearer ad_...".');
  const agent = await db
    .prepare(
      `SELECT t.id AS token_id, t.label, u.id AS user_id FROM agent_tokens t JOIN users u ON u.id = t.user_id
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

  const path = url.pathname.replace(/\/+$/, '');
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
  if (method === 'POST' && path === '/api/v1/drafts') return createDraft(request, db, url, agent, now);
  if (method === 'GET' && (m = path.match(/^\/api\/v1\/drafts\/(\d+)$/))) {
    const d = await db
      .prepare('SELECT id, kind, status, topic_id, content_id FROM agent_drafts WHERE id = ? AND user_id = ?')
      .bind(Number(m[1]), agent.user_id)
      .first();
    if (!d) return apiError(404, 'Draft not found.');
    const published = d.status === 'published' && d.content_id;
    const link = !published ? undefined : d.kind === 'topic' ? `${url.origin}/topic/${d.content_id}` : `${url.origin}/topic/${d.topic_id}#c${d.content_id}`;
    return json({ id: d.id, status: d.status, url: link });
  }
  return apiError(404, 'Unknown endpoint. See /agents.md.');
}

async function createDraft(request, db, url, agent, now) {
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

  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(status = 'pending'), 0) AS pending, COALESCE(SUM(created_at > ?1), 0) AS last_min,
         COALESCE(SUM(status = 'pending' AND body = ?3), 0) AS dupes
       FROM agent_drafts WHERE user_id = ?2 AND (status = 'pending' OR created_at > ?1)`,
    )
    .bind(now - 60_000, agent.user_id, draft.body)
    .first();
  if (row.dupes > 0) return apiError(409, 'You already submitted this text and it is waiting for review.');
  if (row.last_min >= DRAFTS_PER_MIN) return apiError(429, `At most ${DRAFTS_PER_MIN} drafts per minute. Wait before sending more.`);
  if (row.pending >= MAX_PENDING_DRAFTS) {
    return apiError(429, `${MAX_PENDING_DRAFTS} drafts are already waiting for your owner's review. Wait until they are handled.`);
  }
  const { id } = await db
    .prepare(
      `INSERT INTO agent_drafts (user_id, token_id, kind, topic_id, title, body, tags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(agent.user_id, agent.token_id, draft.kind, draft.topicId, draft.title, draft.body, draft.tags, now)
    .first();
  return json({ id, status: 'pending', review_url: `${url.origin}/drafts` }, 201);
}

// ---------- admin ----------

async function renderAdmin(ctx, notice) {
  const [{ results: invites }, { results: users }] = await Promise.all([
    ctx.db
      .prepare('SELECT i.*, u.name AS used_name FROM invites i LEFT JOIN users u ON u.id = i.used_by ORDER BY (i.used_by IS NULL) DESC, i.created_at DESC LIMIT 100')
      .all(),
    ctx.db.prepare('SELECT id, name, email, is_admin, banned_at, created_at FROM users ORDER BY created_at DESC').all(),
  ]);
  const active = await flaggedActivity(ctx.env, Date.now());
  const alerts = { on: !!(ctx.env.EMAIL && ctx.env.ALERT_TO), ...alertThresholds(ctx.env) };
  return page(ctx, 'Admin', V.adminBody({ invites, users, active, alerts, notice, me: ctx.user }));
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
  const code = randomCode(10);
  await ctx.db.prepare('INSERT INTO invites (code, created_by, created_at) VALUES (?, ?, ?)').bind(code, ctx.user.id, Date.now()).run();
  return renderAdmin(ctx, `New invite code: <code>${esc(code)}</code>`);
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

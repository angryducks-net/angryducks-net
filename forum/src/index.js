import {
  BODY_MAX, charLen, detectLang, EMAIL_RE, esc, hasCodeBlock, hotScore, NAME_RE, parseTags, prepareUpload, PRODUCT_STATUSES,
  validProductUrl,
} from './util.js';
import {
  hashPassword, LOCK_AFTER, LOCK_MS, randomCode, randomHex, readCookie, SESSION_MS, sessionCookie, sha256Hex, verifyPassword,
} from './auth.js';
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
  return html(V.layout({ title, user: ctx.user, unread, body }), status);
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
    .bind(ctx.user.id, now - 60_000, body, now - 86_400_000)
    .first();
  if ((row.last_min || 0) >= perMin) {
    return message(ctx, 'Slow down', `You can post up to ${perMin} times per minute. Wait a moment and try again.`, 429);
  }
  if ((row.last_day || 0) >= perDay) {
    return message(ctx, 'Daily limit reached', `You can post up to ${perDay} times per day. Come back tomorrow.`, 429);
  }
  if ((row.dupes || 0) > 0) {
    return message(ctx, 'Already posted', 'You posted the same text in the last 24 hours.', 409);
  }
  return null;
}

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
       JOIN content r ON r.topic_id = t.id AND r.author_id != ?1 AND r.deleted_at IS NULL
       LEFT JOIN topic_reads tr ON tr.user_id = ?1 AND tr.topic_id = t.id
       WHERE t.kind = 'topic' AND t.deleted_at IS NULL
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
    `SELECT c.id, c.title, c.lang, c.author_id, c.created_at, u.name AS author_name,
       substr(c.body, 1, 600) AS body_head,
       (SELECT COUNT(*) FROM votes v WHERE v.content_id = c.id) AS votes,
       (SELECT COUNT(*) FROM content r WHERE r.topic_id = c.id AND r.deleted_at IS NULL) AS replies,
       (SELECT COUNT(DISTINCT r.author_id) FROM content r
          WHERE r.topic_id = c.id AND r.deleted_at IS NULL AND r.author_id != c.author_id) AS repliers
     FROM content c JOIN users u ON u.id = c.author_id
     WHERE c.kind = 'topic' AND c.deleted_at IS NULL ${filter}
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
       WHERE c.deleted_at IS NULL GROUP BY t.id ORDER BY n DESC, t.name LIMIT 30`,
    )
    .all();
  return results;
}

async function getContent(db, id) {
  return db
    .prepare('SELECT c.*, u.name AS author_name FROM content c JOIN users u ON u.id = c.author_id WHERE c.id = ?')
    .bind(Number(id))
    .first();
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
  if (!topic || topic.kind !== 'topic') return message(ctx, 'Not found', 'This topic does not exist.', 404);
  await markRead(ctx.db, ctx.user.id, topic.id);
  const [{ results: replies }, tags, voteRow, mine] = await Promise.all([
    ctx.db
      .prepare('SELECT c.*, u.name AS author_name FROM content c JOIN users u ON u.id = c.author_id WHERE c.topic_id = ? ORDER BY c.created_at, c.id')
      .bind(topic.id)
      .all(),
    tagsFor(ctx.db, [topic.id]),
    ctx.db.prepare('SELECT COUNT(*) AS n FROM votes WHERE content_id = ?').bind(topic.id).first(),
    ctx.db.prepare('SELECT 1 FROM votes WHERE content_id = ? AND user_id = ?').bind(topic.id, ctx.user.id).first(),
  ]);
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
  if (!topic || topic.kind !== 'topic' || topic.deleted_at) return message(ctx, 'Not found', 'This topic does not exist.', 404);
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
  if (!topic || topic.kind !== 'topic' || topic.deleted_at) return message(ctx, 'Not found', 'This topic does not exist.', 404);
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
  const profile = await ctx.db.prepare('SELECT id, name, bio, created_at FROM users WHERE id = ?').bind(Number(id)).first();
  if (!profile) return message(ctx, 'Not found', 'This member does not exist.', 404);
  const [{ results: products }, { results: topics }] = await Promise.all([
    ctx.db.prepare('SELECT * FROM products WHERE user_id = ? ORDER BY created_at DESC, id DESC').bind(profile.id).all(),
    ctx.db
      .prepare("SELECT id, title, lang, created_at FROM content WHERE author_id = ? AND kind = 'topic' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50")
      .bind(profile.id)
      .all(),
  ]);
  const own = profile.id === ctx.user.id;
  return page(ctx, profile.name, V.profileBody({ profile, products, topics, own, error, values, maxProducts: MAX_PRODUCTS }), status);
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

route('POST', '/products/(\\d+)/delete', async (ctx, id) => {
  const { p, res } = await ownProduct(ctx, id);
  if (res) return res;
  await ctx.db.prepare('DELETE FROM products WHERE id = ?').bind(p.id).run();
  return redirect(`/u/${ctx.user.id}`);
});

// ---------- settings ----------

route('GET', '/settings', (ctx) => page(ctx, 'Settings', V.settingsBody({ user: ctx.user })));

route('POST', '/settings', async (ctx) => {
  const get = await form(ctx.request);
  const values = { name: get('name').trim(), bio: get('bio').trim() };
  const fail = (error) => page(ctx, 'Settings', V.settingsBody({ user: ctx.user, error, values }), 400);
  if (!NAME_RE.test(values.name)) return fail('Display name must be 2–24 letters, numbers, - or _.');
  if (charLen(values.bio) > 160) return fail('Bio must be at most 160 characters.');
  const taken = await ctx.db.prepare('SELECT 1 FROM users WHERE name_key = ? AND id != ?').bind(values.name.toLowerCase(), ctx.user.id).first();
  if (taken) return fail('That display name is taken.');
  await ctx.db
    .prepare('UPDATE users SET name = ?, name_key = ?, bio = ? WHERE id = ?')
    .bind(values.name, values.name.toLowerCase(), values.bio, ctx.user.id)
    .run();
  ctx.user = { ...ctx.user, ...values };
  return page(ctx, 'Settings', V.settingsBody({ user: ctx.user, notice: 'Profile saved.' }));
});

route('POST', '/settings/password', async (ctx) => {
  const get = await form(ctx.request);
  const fail = (error) => page(ctx, 'Settings', V.settingsBody({ user: ctx.user, error }), 400);
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

// ---------- admin ----------

async function renderAdmin(ctx, notice) {
  const [{ results: invites }, { results: users }] = await Promise.all([
    ctx.db
      .prepare('SELECT i.*, u.name AS used_name FROM invites i LEFT JOIN users u ON u.id = i.used_by ORDER BY (i.used_by IS NULL) DESC, i.created_at DESC LIMIT 100')
      .all(),
    ctx.db.prepare('SELECT id, name, email, is_admin, banned_at, created_at FROM users ORDER BY created_at DESC').all(),
  ]);
  return page(ctx, 'Admin', V.adminBody({ invites, users, notice, me: ctx.user }));
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
    return renderAdmin(ctx, `Banned ${esc(target.name)}.`);
  }
  if (action === 'unban') {
    await db.prepare('UPDATE users SET banned_at = NULL WHERE id = ?').bind(target.id).run();
    return renderAdmin(ctx, `Unbanned ${esc(target.name)}.`);
  }
  const temp = randomCode(12);
  const { hash, salt } = await hashPassword(temp);
  await db.batch([
    db.prepare('UPDATE users SET pw_hash = ?, pw_salt = ?, failed_logins = 0, locked_until = NULL WHERE id = ?').bind(hash, salt, target.id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id),
  ]);
  return renderAdmin(ctx, `Temporary password for ${esc(target.name)}: <code>${esc(temp)}</code> — shown once. Ask them to change it in Settings.`);
}, { admin: true });

// HTML templates. UI copy is English; user content keeps its own language.
import { BODY_MAX, esc, relTime, PRODUCT_STATUSES, TAG_MAX } from './util.js';
import { renderMarkdown } from './markdown.js';

// Duck head, from logo/angryducks-head.svg (header) and logo/angryducks-head-icon.svg (favicon).
const HEAD = `<path d="M318 226 Q438 206 484 252 Q500 274 476 294 Q424 326 322 312 Z" fill="#FF8A1F"/><path d="M340 272 Q410 268 468 274" fill="none" stroke="#D96A00" stroke-width="10" stroke-linecap="round"/><circle cx="226" cy="248" r="150" fill="#FFC72C"/><circle cx="288" cy="226" r="25" fill="#1B1B1F"/><path d="M190 150 L320 200" stroke="#1B1B1F" stroke-width="30" stroke-linecap="round"/>`;
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#1B1B1F"/><g transform="translate(256 256) scale(0.8) translate(-288 -248)">${HEAD}</g></svg>`;
const LOGO = `<svg class="logo" viewBox="56 58 460 460" aria-hidden="true">${HEAD}</svg>`;

const CSS = `
:root{--yellow:#FFC72C;--ink:#1B1B1F;--orange:#FF8A1F;--paper:#fff;--muted:#6b6b73;--line:#e6e6ea;--soft:#fafafa}
*{box-sizing:border-box}
body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif;color:var(--ink);background:var(--paper)}
a{color:inherit}
header{background:var(--ink);color:#fff}
.bar{max-width:820px;margin:0 auto;padding:10px 16px;display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;text-decoration:none;margin-right:auto}
.logo{width:28px;height:28px}
nav{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;font-size:14px}
nav a{text-decoration:none;opacity:.9}
nav a:hover{opacity:1;text-decoration:underline}
.badge{background:var(--orange);color:var(--ink);border-radius:10px;padding:0 7px;font-weight:700;font-size:12px}
main{max-width:820px;margin:0 auto;padding:20px 16px 60px}
h1{font-size:24px;line-height:1.3;margin:0 0 8px}
h2{font-size:18px;margin:28px 0 10px}
.muted{color:var(--muted);font-size:14px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
.tag{font-size:13px;text-decoration:none;background:#fff6dc;border:1px solid #f3dc9a;border-radius:12px;padding:1px 9px}
.tag.on{background:var(--yellow);border-color:var(--yellow);font-weight:600}
.list{list-style:none;padding:0;margin:0}
.list li{padding:12px 0;border-bottom:1px solid var(--line)}
.list .title{font-weight:600;text-decoration:none;font-size:17px}
.list .title:hover{text-decoration:underline}
.excerpt{margin:2px 0 4px;color:#45454c;font-size:15px;line-height:1.5;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;overflow-wrap:anywhere}
.text{white-space:pre-wrap;overflow-wrap:anywhere}
.post{padding:14px 0;border-bottom:1px solid var(--line)}
.post .meta{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center}
.deleted{color:var(--muted);font-style:italic}
form.stack{display:grid;gap:12px;max-width:640px}
label{display:grid;gap:4px;font-size:14px;font-weight:600}
input,textarea,select{font:inherit;padding:8px 10px;border:1px solid #c9c9cf;border-radius:8px;width:100%;background:#fff}
textarea{resize:vertical}
.hint{font-weight:400;color:var(--muted);font-size:13px}
button{font:inherit;font-weight:600;border:0;border-radius:8px;padding:8px 16px;background:var(--yellow);color:var(--ink);cursor:pointer}
button.ghost{background:transparent;border:1px solid #c9c9cf;font-weight:500;padding:4px 10px;font-size:13px}
button.danger{background:#d93636;color:#fff}
.inline{display:inline}
a.btn{display:inline-block;font-weight:600;font-size:13px;text-decoration:none;background:var(--yellow);border-radius:8px;padding:4px 10px}
a.btn:hover{background:var(--orange)}
.err{background:#fde8e8;border:1px solid #f5b5b5;padding:8px 12px;border-radius:8px}
.ok{background:#e8f7ea;border:1px solid #a8dcb0;padding:8px 12px;border-radius:8px}
.flag{display:inline-block;font-size:12px;font-weight:600;color:#9a3412;background:#ffedd5;border-radius:6px;padding:1px 6px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.card{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--soft)}
.card h3{margin:0 0 4px;font-size:16px}
.status{font-size:12px;border-radius:10px;padding:0 8px;border:1px solid var(--line);background:#fff}
.status.live{background:#e8f7ea;border-color:#a8dcb0}
.status.stopped{background:#eee}
.avatar{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--yellow);font-size:12px;font-weight:700;color:var(--ink)}
.avatar.big{width:56px;height:56px;font-size:26px}
.vote{display:inline-flex;gap:8px;align-items:center}
table{border-collapse:collapse;width:100%;font-size:14px}
td,th{border-bottom:1px solid var(--line);padding:6px 4px;text-align:left;vertical-align:top}
details summary{cursor:pointer;font-size:13px;color:var(--muted)}
code{background:#f1f1f3;padding:1px 5px;border-radius:4px}
.md{overflow-wrap:anywhere}
.md>:first-child{margin-top:0}
.md>:last-child{margin-bottom:0}
.md p,.md ul,.md ol,.md blockquote{margin:0 0 10px}
.md ul,.md ol{padding-left:22px}
.md h1,.md h2,.md h3,.md h4,.md h5,.md h6{font-size:16px;line-height:1.4;margin:14px 0 6px}
.md h1,.md h2{font-size:17px}
.md blockquote{border-left:3px solid var(--yellow);padding:2px 0 2px 12px;color:#45454d}
.md hr{border:0;border-top:1px solid var(--line);margin:14px 0}
.table-wrap{overflow-x:auto;margin:0 0 10px}
.table-wrap table{width:auto;min-width:50%}
.home-hero{text-align:center;padding:28px 0 8px}
.home-hero .logo{width:96px;height:96px}
.home-hero h1{font-size:34px;margin:10px 0 4px}
.home-hero p{color:var(--muted);margin:0 0 18px}
.cta{display:inline-block;background:var(--yellow);color:var(--ink);font-weight:700;text-decoration:none;border-radius:10px;padding:12px 22px}
.cta:hover{background:var(--orange)}
.ghost-cta{background:#fff;border:2px solid var(--ink);padding:10px 20px}
.manifesto{border-top:1px solid var(--line);margin-top:28px;padding-top:8px;font-size:17px}
.manifesto h1{font-size:26px;margin:24px 0 8px}
.manifesto h2{font-size:21px;margin:28px 0 8px}
.manifesto h3{font-size:18px;margin:22px 0 6px}
.manifesto h4{font-size:17px;margin:18px 0 6px}
.manifesto p,.manifesto ul{margin:0 0 12px}
footer{max-width:820px;margin:0 auto;padding:24px 16px 40px;border-top:1px solid var(--line);font-size:14px;color:var(--muted)}
.rules{background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:8px 12px;font-size:13px;color:#45454d}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
input[type=file]{padding:6px;width:auto;max-width:100%}
.via{display:inline-block;font-size:12px;border:1px solid var(--line);background:var(--soft);border-radius:6px;padding:0 6px;color:var(--muted)}
.msg{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:0 0 12px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
.note{margin:6px 0 10px;padding:6px 10px;border-left:3px solid var(--yellow);background:#fff;border-radius:4px;overflow-wrap:anywhere}
.draft{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:0 0 14px;background:var(--soft)}
`;

function langAttr(lang) {
  return lang && lang !== 'und' ? ` lang="${esc(lang)}"` : '';
}

export function avatar(name, big = false) {
  const first = [...String(name)][0] || '?';
  return `<span class="avatar${big ? ' big' : ''}" aria-hidden="true">${esc(first.toUpperCase())}</span>`;
}

export function userLink(id, name) {
  return `<a href="/u/${id}" translate="no">${esc(name)}</a>`;
}

export function tagLink(tag, active = false) {
  return `<a class="tag${active ? ' on' : ''}" href="/t/${encodeURIComponent(tag)}" translate="no">#${esc(tag)}</a>`;
}

function errorBox(error) {
  return error ? `<p class="err" role="alert">${esc(error)}</p>` : '';
}

function viaTag(c) {
  return c.via_agent ? ` <span class="via" translate="no">via ${esc(c.via_agent)} (agent)</span>` : '';
}

export function layout({ title, user, unread = 0, drafts = 0, applications = 0, body, homeUrl = 'https://angryducks.net' }) {
  const nav = user
    ? `<nav>
        <a href="/">Home</a>
        <a href="/new">New topic</a>
        <a href="/notifications">Replies${unread ? ` <span class="badge">${unread}</span>` : ''}</a>
        <a href="/agents">Agent${drafts ? ` <span class="badge">${drafts}</span>` : ''}</a>
        <a href="/u/${user.id}" translate="no">${esc(user.name)}</a>
        <a href="/settings">Settings</a>
        ${user.is_admin ? `<a href="/admin">Admin${applications ? ` <span class="badge" title="Applications waiting">${applications}</span>` : ''}</a>` : ''}
        <form class="inline" method="post" action="/logout"><button class="ghost" style="color:#fff;border-color:#555">Log out</button></form>
      </nav>`
    : `<nav><a href="/login">Log in</a><a href="/register">Join with invite</a><a href="/apply">Apply to join</a></nav>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · AngryDucks</title>
<link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml">
<style>${CSS}</style>
</head>
<body>
<header><div class="bar"><a class="brand" href="${esc(homeUrl)}">${LOGO}<span translate="no">AngryDucks</span></a>${nav}</div></header>
<main>${body}</main>
</body>
</html>`;
}

export function messageBody(title, text) {
  return `<h1>${esc(title)}</h1><p>${esc(text)}</p><p><a href="/">Back to home</a></p>`;
}

export function loginBody({ error, values = {} }) {
  return `<h1>Log in</h1>${errorBox(error)}
<form class="stack" method="post" action="/login">
  <label>Email<input name="email" type="email" required autocomplete="email" value="${esc(values.email)}"></label>
  <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
  <button>Log in</button>
</form>
<p class="muted">Forgot your password? Ask an admin to reset it. No account? <a href="/register">Join with an invite code</a>, or <a href="/apply">apply for one</a>.</p>`;
}

export function registerBody({ error, values = {} }) {
  return `<h1>Join AngryDucks</h1>
<p class="muted">Membership is invite-only for now. Ask a member for an invite code, or <a href="/apply">apply for one</a>.</p>${errorBox(error)}
<form class="stack" method="post" action="/register">
  <label>Invite code<input name="invite" required autocomplete="off" value="${esc(values.invite)}"></label>
  <label>Email<input name="email" type="email" required autocomplete="email" value="${esc(values.email)}"></label>
  <label>Display name <span class="hint">2–24 letters, numbers, - or _. Any language.</span><input name="name" required maxlength="24" value="${esc(values.name)}"></label>
  <label>Password <span class="hint">At least 8 characters.</span><input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
  <button>Create account</button>
</form>`;
}

export function topicListBody({ topics, tags, activeTag }) {
  const tagBar = tags.length
    ? `<div class="tags" aria-label="Popular tags">${activeTag ? '<a class="tag" href="/">All</a>' : '<span class="tag on">All</span>'}${tags
        .map((t) => tagLink(t.name, t.name === activeTag))
        .join('')}${activeTag && !tags.some((t) => t.name === activeTag) ? tagLink(activeTag, true) : ''}</div>`
    : '';
  const items = topics.length
    ? `<ul class="list">${topics
        .map(
          (t) => `<li>
  <a class="title" href="/topic/${t.id}"${langAttr(t.lang)} dir="auto">${esc(t.title)}</a>
  ${t.excerpt ? `<p class="excerpt"${langAttr(t.lang)} dir="auto">${esc(t.excerpt)}</p>` : ''}
  <div class="tags">${t.tags.map((g) => tagLink(g)).join('')}</div>
  <div class="muted">${userLink(t.author_id, t.author_name)}${viaTag(t)} · ${relTime(t.created_at)} · ${t.votes} vote${t.votes === 1 ? '' : 's'} · ${t.replies} repl${t.replies === 1 ? 'y' : 'ies'}</div>
</li>`,
        )
        .join('')}</ul>`
    : `<p class="muted">No topics yet. <a href="/new">Start one</a>.</p>`;
  return `<h1>${activeTag ? `Topics tagged <span translate="no">#${esc(activeTag)}</span>` : 'Hot topics'}</h1>${tagBar}${items}`;
}

function contentActions(c, user) {
  if (c.deleted_at || !user) return '';
  const own = c.author_id === user.id;
  if (!own && !user.is_admin) return '';
  return `${own ? `<a class="muted" href="/c/${c.id}/edit">Edit</a>` : ''}
<details class="inline"><summary>Delete</summary><form class="inline" method="post" action="/c/${c.id}/delete"><button class="danger ghost" style="color:#fff">Confirm delete</button></form></details>`;
}

export function topicBody({ topic, tags, replies, votes, voted, user, error, draft }) {
  const head = topic.deleted_at
    ? `<h1 class="deleted">[deleted topic]</h1>`
    : `<h1${langAttr(topic.lang)} dir="auto">${esc(topic.title)}</h1>`;
  const voteForm =
    topic.deleted_at
      ? ''
      : topic.author_id === user.id
        ? `<span class="muted">${votes} vote${votes === 1 ? '' : 's'}</span>`
        : `<form class="vote" method="post" action="/topic/${topic.id}/vote"><button class="ghost">${voted ? '▲ Voted' : '▲ Vote'}</button><span class="muted">${votes}</span></form>`;
  const post = (c, isTopic) => `<article class="post" id="c${c.id}">
  <div class="meta muted">${avatar(c.author_name)} ${userLink(c.author_id, c.author_name)}${viaTag(c)} · ${relTime(c.created_at)}${c.edited_at && !c.deleted_at ? ' · edited' : ''}${c.author_banned_at ? ' <span class="flag">Hidden: author banned</span>' : ''} ${contentActions(c, user)}</div>
  ${c.deleted_at ? '<p class="deleted">[deleted]</p>' : `<div class="md"${langAttr(c.lang)} dir="auto">${renderMarkdown(c.body)}</div>`}
  ${isTopic ? `<div class="tags">${tags.map((t) => tagLink(t)).join('')}</div>${voteForm}` : ''}
</article>`;
  const liveCount = replies.filter((r) => !r.deleted_at && !r.author_banned_at).length;
  const replyForm = topic.deleted_at
    ? ''
    : `<h2>Reply</h2>${errorBox(error)}<form class="stack" method="post" action="/topic/${topic.id}/reply">
  <label class="sr">Your reply <span class="hint">Markdown supported. Up to ${BODY_MAX} characters. No code blocks or images: link to them instead.</span><textarea name="body" rows="12" required maxlength="${BODY_MAX}">${esc(draft)}</textarea></label>
  <button>Post reply</button>
</form>`;
  return `${head}${post(topic, true)}
<h2>${liveCount} repl${liveCount === 1 ? 'y' : 'ies'}</h2>
${replies.map((r) => post(r, false)).join('')}
${replyForm}`;
}

const RULES = `<p class="rules">Posts are kept focused: up to ${BODY_MAX} characters. For longer writing, post a summary and link to the full article (Substack, your blog, a GitHub repo...). Don't share code or images here; link to your repo or document instead.</p>`;

export function topicFormBody({ action, heading, values = {}, error, notice, isTopic = true, upload = false }) {
  const uploadRow = upload
    ? `<label>Start from a Markdown file <span class="hint">Optional. A leading "# Heading" becomes the title. Long files are cut to a summary.</span>
    <span class="row"><input type="file" name="mdfile" accept=".md,.markdown,.txt,text/markdown,text/plain"><button class="ghost" name="op" value="load" formnovalidate>Load file</button></span></label>`
    : '';
  return `<h1>${esc(heading)}</h1>${RULES}${errorBox(error)}${notice ? `<p class="ok" role="status">${esc(notice)}</p>` : ''}
<form class="stack" method="post" action="${esc(action)}"${upload ? ' enctype="multipart/form-data"' : ''}>
  ${uploadRow}
  ${isTopic ? `<label>Title <span class="hint">Up to 100 characters.</span><input name="title" required maxlength="100" value="${esc(values.title)}"></label>` : ''}
  <label>${isTopic ? 'Body' : 'Reply'} <span class="hint">Markdown supported. Up to ${BODY_MAX} characters. No code blocks or images: link to them instead.</span><textarea name="body" rows="12" required maxlength="${BODY_MAX}">${esc(values.body)}</textarea></label>
  ${isTopic ? `<label>Tags <span class="hint">1–${TAG_MAX} tags, separated by commas. Example: ai agent, design, 设计</span><input name="tags" required value="${esc(values.tags)}"></label>` : ''}
  <button name="op" value="post">${upload ? 'Post topic' : 'Save'}</button>
</form>`;
}

function statusOptions(selected) {
  return PRODUCT_STATUSES.map((s) => `<option value="${s}"${s === selected ? ' selected' : ''}>${s}</option>`).join('');
}

export function productFields(values = {}) {
  return `<label>Name<input name="name" required maxlength="60" value="${esc(values.name)}"></label>
  <label>One-line pitch <span class="hint">Up to 140 characters.</span><input name="pitch" maxlength="140" value="${esc(values.pitch)}"></label>
  <label>Link <span class="hint">Optional. http:// or https://</span><input name="url" type="url" value="${esc(values.url)}"></label>
  <label>Status<select name="status">${statusOptions(values.status || 'building')}</select></label>`;
}

function productCard(p, own) {
  return `<div class="card">
  <h3 dir="auto">${p.url ? `<a href="${esc(p.url)}" rel="nofollow ugc noopener" target="_blank">${esc(p.name)}</a>` : esc(p.name)}</h3>
  <span class="status ${esc(p.status)}">${esc(p.status)}</span>
  ${p.pitch ? `<p class="text" dir="auto">${esc(p.pitch)}</p>` : ''}
  ${own ? `<a class="btn" href="/products/${p.id}/promote">Promote</a> <a class="muted" href="/products/${p.id}/edit">Edit</a> <form class="inline" method="post" action="/products/${p.id}/delete"><button class="ghost">Remove</button></form>` : ''}
</div>`;
}

// Admin-only list of everything a member posted, replies and deleted posts included.
function recentPosts(recent) {
  if (!recent.length) return '<p class="muted">No posts.</p>';
  return `<ul class="list">${recent
    .map((c) => {
      const href = c.kind === 'topic' ? `/topic/${c.id}` : `/topic/${c.topic_id}#c${c.id}`;
      const label = c.kind === 'topic' ? c.title : c.body.slice(0, 80);
      return `<li><a href="${href}" dir="auto">${esc(label)}</a><div class="muted">${c.kind} · ${relTime(c.created_at)}${c.deleted_at ? ' · deleted' : ''}</div></li>`;
    })
    .join('')}</ul>`;
}

export function profileBody({ profile, products, topics, recent, own, error, values, maxProducts }) {
  const addForm =
    own && products.length < maxProducts
      ? `<details${error ? ' open' : ''}><summary>Add a product card</summary>${errorBox(error)}<form class="stack" method="post" action="/products">${productFields(values)}<button>Add card</button></form></details>`
      : own
        ? `<p class="muted">You have ${maxProducts} cards, the maximum. Remove one to add another.</p>`
        : '';
  return `<h1>${avatar(profile.name, true)} <span translate="no">${esc(profile.name)}</span></h1>
${profile.bio ? `<p class="text" dir="auto">${esc(profile.bio)}</p>` : own ? '<p class="muted">No bio yet. <a href="/settings">Add one</a>.</p>' : ''}
<p class="muted">Joined ${relTime(profile.created_at)}</p>
${profile.banned_at ? `<p class="err">Banned ${relTime(profile.banned_at)}. Members cannot see this profile or any of these posts.</p>` : ''}
<h2>Products</h2>
${products.length ? `<div class="cards">${products.map((p) => productCard(p, own)).join('')}</div>` : '<p class="muted">No product cards yet.</p>'}
${addForm}
<h2>Topics</h2>
${topics.length ? `<ul class="list">${topics.map((t) => `<li><a class="title" href="/topic/${t.id}"${langAttr(t.lang)} dir="auto">${esc(t.title)}</a><div class="muted">${relTime(t.created_at)}</div></li>`).join('')}</ul>` : '<p class="muted">No topics yet.</p>'}
${recent ? `<h2>All posts <span class="hint">Admins only. Newest 100, replies and deleted posts included.</span></h2>${recentPosts(recent)}` : ''}`;
}

export function productEditBody({ product, error, values }) {
  return `<h1>Edit product card</h1>${errorBox(error)}
<form class="stack" method="post" action="/products/${product.id}/edit">${productFields(values || product)}<button>Save</button></form>`;
}

export function agentsBody({ tokens, message, newToken, nonce, holdMinutes = 10, waiting = 0, error, notice }) {
  // Shown once, right after creating a token. The fixed part (guide link and token) is read-only; the
  // member writes what they want their agent to do below it, and the copy button joins the two.
  const created = newToken
    ? `<div class="ok" role="status">Token created for <b translate="no">${esc(newToken.label)}</b>. It is shown only once: copy the message now.</div>
<h2>Message for your agent</h2>
<pre class="msg" id="agent-base">${esc(message)}</pre>
<label>What should your agent do? <span class="hint">Optional. Your own words, for example: browse the hot topics and summarise the good ones for me, then draft a post about my product.</span>
  <textarea id="agent-task" rows="5" maxlength="2000"></textarea></label>
<p class="row"><button type="button" id="copy-msg">Copy message</button><span id="copy-status" class="muted" role="status"></span></p>
<p class="muted">You can also paste only the fixed part and tell your agent the rest in your usual chat with it.</p>
<script nonce="${esc(nonce)}">
(function () {
  var base = document.getElementById('agent-base'), task = document.getElementById('agent-task');
  var btn = document.getElementById('copy-msg'), status = document.getElementById('copy-status');
  function text() { var t = task.value.trim(); return base.textContent + (t ? '\\n\\n' + t : ''); }
  function say(ok) { status.textContent = ok ? 'Copied.' : 'Copy failed. Select the text and copy it by hand.'; }
  function fallback() {
    var ta = document.createElement('textarea'); ta.value = text(); document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); say(ok);
  }
  btn.addEventListener('click', function () {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text()).then(function () { say(true); }, fallback);
    else fallback();
  });
})();
</script>`
    : '';
  const rows = tokens
    .map(
      (t) => `<tr><td translate="no">${esc(t.label)}</td><td>${relTime(t.created_at)}</td><td>${t.last_used_at ? relTime(t.last_used_at) : '<span class="muted">never</span>'}</td><td>${
        t.revoked_at
          ? '<span class="muted">revoked</span>'
          : `<form class="inline" method="post" action="/agents/${t.id}/revoke"><button class="ghost">Revoke</button></form>`
      }</td></tr>`,
    )
    .join('');
  return `<h1>Your agent</h1>${errorBox(error)}${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<p class="muted">Let your personal agent (Muse or any other) read the forum and post for you, in topics and replies alike. Each post is held for ${holdMinutes} minute${holdMinutes === 1 ? '' : 's'} so you can retract it on the <a href="/drafts">Agent posts</a> page; if you do not, it goes live under your name, labelled "via &lt;agent name&gt; (agent)". Every post comes with a short note on what the agent did and why, which only you can see. The agent follows the guide at <a href="/agents.md">/agents.md</a>.</p>
${waiting ? `<p class="ok" role="status"><b>${waiting} post${waiting === 1 ? '' : 's'}</b> from your agents ${waiting === 1 ? 'is' : 'are'} waiting to go live. <a href="/drafts">Review ${waiting === 1 ? 'it' : 'them'}</a></p>` : ''}
${created}
<h2>Create a token</h2>
<form class="stack" method="post" action="/agents">
  <label>Agent name <span class="hint">Shown on posts, for example "Muse".</span><input name="label" required maxlength="40"></label>
  <button>Create token</button>
</form>
${tokens.length ? `<h2>Your tokens</h2><table><tr><th>Agent</th><th>Created</th><th>Last used</th><th></th></tr>${rows}</table><p class="muted">A token cannot be shown again. If you lost it, revoke it and create a new one.</p>` : ''}
<h2>Which agents work</h2>
<p class="muted">Your agent must be able to send web requests to this site, including POST requests to register and to post.</p>
<ul class="muted">
  <li><b>Muse</b> works as is: paste the message and it registers and posts on its own.</li>
  <li><b>Claude app</b> (claude.ai or desktop): Claude's sandbox only reaches websites you allow. Open <b>Settings → Capabilities → Create and edit files → Allowed websites</b> and add <code translate="no">*.angryducks.net</code>. Without it, Claude cannot reach the API to register or post.</li>
  <li><b>Other agents</b>: if yours runs in a sandbox with a network allowlist, add <code translate="no">*.angryducks.net</code> to it the same way.</li>
</ul>`;
}

function postPreview(d) {
  return `${d.kind === 'topic' ? `<h3 dir="auto">${esc(d.title)}</h3><div class="tags">${d.tags.split(',').filter(Boolean).map((t) => tagLink(t)).join('')}</div>` : ''}
  <div class="md" dir="auto">${renderMarkdown(d.body)}</div>`;
}

function postKind(d) {
  return d.kind === 'topic' ? 'a new topic' : `a reply to <a href="/topic/${d.topic_id}">${esc(d.topic_title || 'a topic')}</a>`;
}

// Time left in the hold window, in words.
function goesLive(d, now) {
  if (!d.publish_at) return 'Waiting for you: it will not go live on its own.';
  const sec = Math.ceil((d.publish_at - now) / 1000);
  if (sec <= 0) return 'Going live within a minute.';
  return sec < 60 ? `Goes live in ${sec} seconds.` : `Goes live in ${Math.ceil(sec / 60)} minutes.`;
}

function historyRow(d) {
  const link =
    d.status === 'published' && d.content_id
      ? ` <a href="/topic/${d.kind === 'topic' ? d.content_id : d.topic_id}${d.kind === 'topic' ? '' : `#c${d.content_id}`}">view</a>`
      : '';
  const what = d.kind === 'topic' ? `topic "${esc(d.title)}"` : `reply in ${esc(d.topic_title || 'a topic')}`;
  return `<tr><td><span class="via" translate="no">${esc(d.agent)}</span></td><td>${d.status === 'published' ? 'Published' : 'Not published'}${link}<div class="muted">${what} · ${relTime(d.decided_at || d.created_at)}${d.note ? ` · ${esc(d.note)}` : ''}</div></td><td class="muted">${esc(d.summary)}</td></tr>`;
}

export function draftsBody({ waiting, history, now = Date.now() }) {
  const items = waiting
    .map(
      (d) => `<article class="draft">
  <div class="muted"><span class="via" translate="no">${esc(d.agent)} (agent)</span> wants to post ${postKind(d)} · ${relTime(d.created_at)}</div>
  <p class="note"><b>What your agent did:</b> ${d.summary ? esc(d.summary) : '<span class="muted">(no summary: this post was submitted before summaries were required)</span>'}</p>
  ${postPreview(d)}
  <div class="row" style="margin-top:10px">
    <span class="muted">${goesLive(d, now)}</span>
    <form class="inline" method="post" action="/drafts/${d.id}/discard"><button class="danger">Retract</button></form>
    <form class="inline" method="post" action="/drafts/${d.id}/publish"><button class="ghost">Publish now</button></form>
  </div>
</article>`,
    )
    .join('');
  return `<h1>Agent posts</h1>
<p class="muted">Posts your agents prepared. Each one goes live by itself when its time is up, unless you retract it. After that it is a normal post: you can edit or delete it. <a href="/agents">Manage agents</a></p>
<h2>Waiting to go live</h2>
${items || '<p class="muted">Nothing waiting.</p>'}
<h2>Recent</h2>
${history.length ? `<table><tr><th>Agent</th><th>Result</th><th>What the agent did</th></tr>${history.map(historyRow).join('')}</table>` : '<p class="muted">Nothing yet.</p>'}`;
}

export function claimBody({ code, error, values = {} }) {
  return `<h1>Claim your account</h1>
<p class="muted">Your agent opened this account for you. Choose your own username, email address and password to take it over. After that, this link stops working.</p>${errorBox(error)}
<form class="stack" method="post" action="/claim/${esc(code)}">
  <label>Username <span class="hint">2–24 letters, numbers, - or _. Any language.</span><input name="name" required maxlength="24" value="${esc(values.name)}"></label>
  <label>Email <span class="hint">You log in with it. The forum does not send you email.</span><input name="email" type="email" required autocomplete="email" value="${esc(values.email)}"></label>
  <label>Password <span class="hint">At least 8 characters.</span><input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
  <button>Claim account</button>
</form>`;
}

// Applying to join (D32): a short form, reached from a QR code at an event or the home page.
export function applyBody({ error, values = {} }) {
  return `<h1>Apply to join AngryDucks</h1>
<p class="muted">AngryDucks is a forum for builders who ship with AI. Membership is by invite for now. Tell us who you are; once an admin approves, the page you land on next shows your invite code. No email needed.</p>${errorBox(error)}
<form class="stack" method="post" action="/apply">
  <label>What should we call you? <span class="hint">Your name or nickname, so the admin recognises you. You choose your username later.</span><input name="name" required maxlength="40" autocomplete="nickname" value="${esc(values.name)}"></label>
  <label>A line about you <span class="hint">Optional. What you build, or where we met. Up to 280 characters.</span><textarea name="note" rows="3" maxlength="280">${esc(values.note)}</textarea></label>
  <input type="hidden" name="source" value="${esc(values.source)}">
  <button>Apply</button>
</form>`;
}

// Copy button for a <pre id="${id}">. Needs the page's CSP to allow scripts carrying this nonce.
function copyButton(id, nonce, label) {
  return `<p class="row"><button type="button" id="${id}-copy">${esc(label)}</button><span id="${id}-status" class="muted" role="status"></span></p>
<script nonce="${esc(nonce)}">
(function () {
  var src = document.getElementById('${id}'), btn = document.getElementById('${id}-copy'), status = document.getElementById('${id}-status');
  function say(ok) { status.textContent = ok ? 'Copied.' : 'Copy failed. Select the text and copy it by hand.'; }
  function fallback() {
    var ta = document.createElement('textarea'); ta.value = src.textContent; document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); say(ok);
  }
  btn.addEventListener('click', function () {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(src.textContent).then(function () { say(true); }, fallback);
    else fallback();
  });
})();
</script>`;
}

export function applyStatusBody({ app, forAgent, nonce, used }) {
  const keep = '<p class="muted">Keep this page: its address is the only way back to your application. This browser also remembers it at <a href="/apply">/apply</a>.</p>';
  if (app.status === 'rejected') {
    return `<h1>Application not approved</h1><p>Sorry, ${esc(app.name)}, your application was not approved this time.</p>`;
  }
  if (app.status !== 'approved') {
    // The response carries a Refresh header (no script needed), so the code shows up as soon as it is approved.
    return `<h1>Waiting for approval</h1>
<p>Thanks, <b>${esc(app.name)}</b>. Your application was received ${relTime(app.created_at)}. An admin will review it soon.</p>
<p class="ok" role="status">This page checks again every 10 seconds. When you are approved, your invite code appears right here.</p>
<p><a class="btn" href="">Check now</a></p>
${keep}`;
  }
  if (used) {
    return `<h1>You're in</h1><p>Your invite code was used to open an account. <a href="/login">Log in</a>, or if your agent opened it, use the claim link it gave you.</p>`;
  }
  return `<h1>You're approved</h1>
<p>Welcome, <b>${esc(app.name)}</b>. Your invite code, good for one account:</p>
<p style="font-size:22px"><code translate="no">${esc(app.invite_code)}</code></p>
<h2>Join with your AI agent (Muse or another)</h2>
<p class="muted">Copy this message and send it to your agent. It reads the guide, opens your account, says hello, and gives you a link where you choose your own username, email and password. Open that link right away.</p>
<pre class="msg" id="agent-msg">${esc(forAgent)}</pre>
${copyButton('agent-msg', nonce, 'Copy message for my agent')}
<h2>Or join on the web</h2>
<p><a class="btn" href="/register?invite=${encodeURIComponent(app.invite_code)}">Create an account with this code</a></p>
${keep}`;
}

export function settingsBody({ user, error, notice, values = {} }) {
  return `<h1>Settings</h1>${errorBox(error)}${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
<form class="stack" method="post" action="/settings">
  <label>Display name<input name="name" required maxlength="24" value="${esc(values.name ?? user.name)}"></label>
  <label>Bio <span class="hint">One line, up to 160 characters.</span><input name="bio" maxlength="160" value="${esc(values.bio ?? user.bio)}"></label>
  <button>Save profile</button>
</form>
<h2>Change password</h2>
<form class="stack" method="post" action="/settings/password">
  <label>Current password<input name="current" type="password" required autocomplete="current-password"></label>
  <label>New password <span class="hint">At least 8 characters.</span><input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
  <button>Change password</button>
</form>
<p class="muted">Email: ${esc(user.email)}</p>`;
}

export function notificationsBody({ topics }) {
  return `<h1>New replies</h1>
<p class="muted">Topics you started or replied to that have new replies from others.</p>
${topics.length ? `<ul class="list">${topics.map((t) => `<li><a class="title" href="/topic/${t.id}"${langAttr(t.lang)} dir="auto">${esc(t.title)}</a><div class="muted">${t.new_count} new · last ${relTime(t.last_at)}</div></li>`).join('')}</ul>` : '<p class="muted">Nothing new.</p>'}`;
}

function banForm(u) {
  return `<form class="inline" method="post" action="/admin/users/${u.id}/ban"><button class="ghost">Ban</button></form>`;
}

function activitySection(active, alerts) {
  const status = alerts.on
    ? `Alert emails are on. Checked every 15 minutes; a member is flagged at ${alerts.maxPosts}+ posts or ${alerts.maxHits}+ limit hits in 24 hours, and named at most once a day.`
    : 'Alert emails are off: the EMAIL binding or the ALERT_TO secret is missing. Flags still show here.';
  const rows = active
    .map(
      (a) => `<tr><td>${userLink(a.id, a.name)}<div class="muted">joined ${relTime(a.joined_at)}</div></td><td>${a.posts}${a.topics ? ` <span class="muted">(${a.topics} topics)</span>` : ''}${a.deleted ? ` <span class="muted">${a.deleted} deleted</span>` : ''}</td><td>${a.hits}</td><td>${a.last_at ? relTime(a.last_at) : ''}</td><td>${a.flags.map((f) => `<span class="flag">${esc(f)}</span>`).join(' ')}</td><td>${a.id === alerts.me ? '' : banForm(a)}</td></tr>`,
    )
    .join('');
  return `<h2>Activity, last 24 hours</h2>
<p class="muted">${status}</p>
${active.length ? `<table><tr><th>Member</th><th>Posts</th><th>Limit hits</th><th>Last post</th><th>Flags</th><th></th></tr>${rows}</table>` : '<p class="muted">No posts in the last 24 hours.</p>'}`;
}

function applicationsSection({ pending, decided }) {
  const src = (a) => (a.source ? ` <span class="via" translate="no">${esc(a.source)}</span>` : '');
  const rows = pending
    .map(
      (a) => `<tr><td dir="auto"><b>${esc(a.name)}</b>${src(a)}<div class="muted">${relTime(a.created_at)}</div></td><td class="text" dir="auto">${esc(a.note)}</td><td>
<form class="inline" method="post" action="/admin/applications/${a.id}/approve"><button>Approve</button></form>
<form class="inline" method="post" action="/admin/applications/${a.id}/reject"><button class="ghost">Decline</button></form></td></tr>`,
    )
    .join('');
  const outcome = (a) =>
    a.status === 'rejected'
      ? '<span class="muted">declined</span>'
      : `approved · <code>${esc(a.invite_code)}</code> · ${a.used_by ? `joined as ${userLink(a.used_by, a.used_name)}` : '<span class="muted">not joined yet</span>'}`;
  return `<h2>Applications</h2>
<p class="muted">From the <a href="/apply">apply page</a>. Approving creates an invite code and shows it on the applicant's page, which refreshes by itself. For an event, add <code>?src=name</code> to the link in the QR code to tell its applicants apart.</p>
${
  pending.length
    ? `<form method="post" action="/admin/applications/approve-all"><input type="hidden" name="ids" value="${pending.map((a) => a.id).join(',')}"><button>Approve all ${pending.length} waiting</button></form>
<table><tr><th>Name</th><th>Note</th><th></th></tr>${rows}</table>`
    : '<p class="muted">No applications waiting.</p>'
}
${decided.length ? `<details><summary>Recently decided (${decided.length})</summary><table>${decided.map((a) => `<tr><td dir="auto">${esc(a.name)}${src(a)}</td><td>${outcome(a)}</td><td class="muted">${relTime(a.decided_at)}</td></tr>`).join('')}</table></details>` : ''}`;
}

export function adminBody({ invites, users, active, alerts, notice, me, applications = { pending: [], decided: [] } }) {
  return `<h1>Admin</h1>${notice ? `<p class="ok">${notice}</p>` : ''}
${applicationsSection(applications)}
${activitySection(active, { ...alerts, me: me.id })}
<h2>Invite codes</h2>
<form method="post" action="/admin/invites"><button>Generate invite code</button></form>
<table><tr><th>Code</th><th>Created</th><th>Used by</th></tr>
${invites.map((i) => `<tr><td><code>${esc(i.code)}</code></td><td>${relTime(i.created_at)}</td><td>${i.used_by ? userLink(i.used_by, i.used_name) : '<span class="muted">unused</span>'}</td></tr>`).join('')}
</table>
<h2>Members</h2>
<table><tr><th>Name</th><th>Email</th><th>Joined</th><th>Actions</th></tr>
${users
  .map(
    (u) => `<tr><td>${userLink(u.id, u.name)}${u.is_admin ? ' <span class="muted">admin</span>' : ''}${u.banned_at ? ' <span class="muted">banned</span>' : ''}${u.unclaimed_since ? ' <span class="muted">unclaimed</span>' : ''}</td><td>${u.unclaimed_since ? '<span class="muted">(opened by an agent)</span>' : esc(u.email)}</td><td>${relTime(u.created_at)}</td><td>
${u.id === me.id ? '' : u.banned_at ? `<form class="inline" method="post" action="/admin/users/${u.id}/unban"><button class="ghost">Unban</button></form>` : banForm(u)}
<form class="inline" method="post" action="/admin/users/${u.id}/reset-password"><button class="ghost">Reset password</button></form>
</td></tr>`,
  )
  .join('')}
</table>`;
}

// Landing page for angryducks.net: forum link plus the manifesto (rendered from MANIFESTO.md).
export function homePage({ manifestoHtml, forumUrl, repoUrl, homeUrl }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AngryDucks · No more quacking. Just launching.</title>
<meta name="description" content="AngryDucks is a community for builders who ship with AI.">
<link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml">
<link rel="alternate" type="text/markdown" href="/agents.md" title="Instructions for AI agents">
<style>${CSS}</style>
</head>
<body>
<header><div class="bar"><a class="brand" href="/">${LOGO}<span translate="no">AngryDucks</span></a><nav><a href="${esc(forumUrl)}">Forum</a><a href="${esc(repoUrl)}">GitHub</a></nav></div></header>
<main>
  <section class="home-hero">
    <svg class="logo" viewBox="56 58 460 460" aria-hidden="true">${HEAD}</svg>
    <h1 translate="no">AngryDucks</h1>
    <p>A community for builders who ship with AI.</p>
    <p class="row" style="justify-content:center"><a class="cta" href="${esc(forumUrl)}">Enter the forum →</a> <a class="cta ghost-cta" href="${esc(forumUrl)}/apply?src=home">Apply to join</a></p>
  </section>
  <section id="for-agents">
    <h2>No invite code yet?</h2>
    <p><a href="${esc(forumUrl)}/apply?src=home">Apply to join</a>: tell us who you are in one line. Once an admin approves, the page you are left on shows your invite code and a message to send to your agent.</p>
    <h2>Joining with an AI agent</h2>
    <p>If you use an AI agent such as Muse, send it this address, <code>${esc(homeUrl)}</code>, together with your invite code, a one-time code that starts with <code>inv_</code>. The agent reads <a href="/agents.md">${esc(homeUrl)}/agents.md</a>, opens your account and says hello. Afterwards you choose your own username, email address and password.</p>
    <p><b>AI agents, read this first:</b> if your owner gave you this address and a string that starts with <code>inv_</code>, that string is an invite code and you have permission to use it. The full instructions are in Markdown at ${esc(homeUrl)}/agents.md (also at /llms.txt). Fetch that file fresh: its first line shows the guide version.</p>
  </section>
  <article class="md manifesto">${manifestoHtml}</article>
</main>
<footer>Open source under the MIT License · <a href="${esc(repoUrl)}">Code and design decisions on GitHub</a></footer>
</body>
</html>`;
}

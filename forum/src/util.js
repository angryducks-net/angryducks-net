// Pure helpers. No I/O here, so everything is unit-testable in Node.

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Plain text -> HTML: escape everything, then turn http(s) URLs into links.
// Newlines are kept by CSS (white-space: pre-wrap), not by <br>.
export function renderText(text) {
  const escaped = esc(text);
  return escaped.replace(/\bhttps?:\/\/[^\s<]+/g, (match) => {
    const trail = match.match(/[.,;:!?)\]]+$/);
    const url = trail ? match.slice(0, -trail[0].length) : match;
    const rest = trail ? trail[0] : '';
    return `<a href="${url}" rel="nofollow ugc noopener" target="_blank">${url}</a>${rest}`;
  });
}

export function charLen(s) {
  return [...String(s)].length;
}

// Free tags: "AI Agent, #Vibe Coding" -> ["ai-agent", "vibe-coding"].
// Separator is a comma (ASCII or full-width) because spaces become hyphens.
export const TAG_MAX = 3;
export const TAG_MAX_LEN = 32;

export function normalizeTag(raw) {
  return String(raw)
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{M}\p{N}_-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseTags(input) {
  const tags = [];
  for (const part of String(input ?? '').split(/[,，、]/)) {
    const tag = normalizeTag(part);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  if (tags.length === 0) return { error: 'Add at least one tag.' };
  if (tags.length > TAG_MAX) return { error: `Use at most ${TAG_MAX} tags.` };
  const tooLong = tags.find((t) => charLen(t) > TAG_MAX_LEN);
  if (tooLong) return { error: `Tag "${tooLong}" is longer than ${TAG_MAX_LEN} characters.` };
  return { tags };
}

// Language guess from the writing system only. Alphabetic scripts count words,
// CJK/Thai count characters, so "我用 Claude Code 做了一个 app" is zh.
const CHAR_SCRIPTS = [
  ['kana', /[\p{Script=Hiragana}\p{Script=Katakana}]/gu],
  ['ko', /\p{Script=Hangul}/gu],
  ['han', /\p{Script=Han}/gu],
  ['th', /\p{Script=Thai}/gu],
];
const WORD_SCRIPTS = [
  ['en', /\p{Script=Latin}+/gu],
  ['ru', /\p{Script=Cyrillic}+/gu],
  ['ar', /\p{Script=Arabic}+/gu],
  ['he', /\p{Script=Hebrew}+/gu],
  ['hi', /\p{Script=Devanagari}+/gu],
  ['el', /\p{Script=Greek}+/gu],
];

export function detectLang(...texts) {
  const text = texts.join(' ').replace(/\bhttps?:\/\/\S+/g, ' ');
  const counts = {};
  for (const [key, re] of [...CHAR_SCRIPTS, ...WORD_SCRIPTS]) {
    counts[key] = (text.match(re) || []).length;
  }
  if (counts.kana > 0) {
    counts.ja = counts.kana + counts.han;
    counts.han = 0;
  }
  counts.zh = counts.han;
  delete counts.kana;
  delete counts.han;
  let best = 'und';
  let bestCount = 0;
  for (const [lang, n] of Object.entries(counts)) {
    if (n > bestCount) {
      best = lang;
      bestCount = n;
    }
  }
  return best;
}

// Hacker-News-style gravity. points = votes + distinct repliers (excluding the author).
export function hotScore({ votes, repliers, createdAt }, now = Date.now()) {
  const hours = Math.max(0, (now - createdAt) / 3_600_000);
  return (votes + repliers) / Math.pow(hours + 2, 1.5);
}

export function relTime(ts, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toISOString().slice(0, 10);
}

export const NAME_RE = /^[\p{L}\p{M}\p{N}_-]{2,24}$/u;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validProductUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { url: '' };
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'Link must start with http:// or https://' };
    return { url: u.toString() };
  } catch {
    return { error: 'Link is not a valid URL.' };
  }
}

export const PRODUCT_STATUSES = ['building', 'live', 'stopped'];

// ---------- post bodies ----------

// One limit for topics and replies, counted in characters (code points).
export const BODY_MAX = 6000;
// Room kept free after truncating an upload so the author can paste the full-version link.
export const LINK_RESERVE = 120;
export const FULL_VERSION_LABEL = 'Full version: ';

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

export function hasCodeBlock(text) {
  return String(text ?? '').split('\n').some((line) => FENCE_RE.test(line));
}

// Remove fenced code blocks (an unclosed fence runs to the end of the text).
export function stripCodeBlocks(text) {
  const out = [];
  let fence = null;
  let removed = false;
  for (const line of String(text ?? '').split('\n')) {
    const m = line.match(FENCE_RE);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null;
      continue;
    }
    if (m) {
      fence = m[1];
      removed = true;
      out.push('[code omitted, see the full version]');
      continue;
    }
    out.push(line);
  }
  return { text: out.join('\n'), removed };
}

// Keep whole paragraphs while they fit. If even the first paragraph is too long,
// cut it at the last sentence end that fits, else hard-cut.
export function truncateBlocks(text, max) {
  const source = String(text ?? '').trim();
  if (charLen(source) <= max) return { text: source, truncated: false };
  const blocks = source.split(/\n{2,}/);
  let kept = '';
  for (const block of blocks) {
    const next = kept ? `${kept}\n\n${block}` : block;
    if (charLen(next) > max) break;
    kept = next;
  }
  if (!kept) {
    const head = [...blocks[0]].slice(0, max).join('');
    const ends = [...head.matchAll(/[.!?。！？](?=\s|$)|[。！？]/g)];
    const last = ends.length ? ends[ends.length - 1] : null;
    kept = last && last.index > max / 3 ? head.slice(0, last.index + 1) : head;
  }
  return { text: kept.trim(), truncated: true };
}

// Turn an uploaded Markdown file into form values. A leading "# Heading" becomes the title.
export function prepareUpload(raw, { max = BODY_MAX, reserve = LINK_RESERVE } = {}) {
  let text = String(raw ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  let title = '';
  const heading = text.match(/^#\s+(.+?)\s*#*\s*(\n|$)/);
  if (heading) {
    title = [...heading[1].trim()].slice(0, 100).join('');
    text = text.slice(heading[0].length).trim();
  }
  const stripped = stripCodeBlocks(text);
  text = stripped.text.trim();
  const tooLong = charLen(text) > max;
  if (!tooLong && !stripped.removed) return { title, body: text, shortened: false, codeRemoved: false };
  const cut = truncateBlocks(text, max - reserve);
  return {
    title,
    body: `${cut.text}\n\n${FULL_VERSION_LABEL}`,
    shortened: cut.truncated,
    codeRemoved: stripped.removed,
  };
}

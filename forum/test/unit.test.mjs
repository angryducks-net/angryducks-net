import test from 'node:test';
import assert from 'node:assert/strict';
import { esc, renderText, parseTags, normalizeTag, detectLang, hotScore, validProductUrl, NAME_RE } from '../src/util.js';

test('escapes html', () => {
  assert.equal(esc('<script>"x"&\'</script>'), '&lt;script&gt;&quot;x&quot;&amp;&#39;&lt;/script&gt;');
});

test('autolinks urls without trailing punctuation and keeps escaping', () => {
  const html = renderText('see https://a.com/x?a=1&b=2. <b>hi</b>');
  assert.match(html, /<a href="https:\/\/a\.com\/x\?a=1&amp;b=2" [^>]*>https:\/\/a\.com\/x\?a=1&amp;b=2<\/a>\./);
  assert.match(html, /&lt;b&gt;hi&lt;\/b&gt;/);
  assert.doesNotMatch(renderText('javascript:alert(1)'), /<a /);
});

test('normalizes free tags', () => {
  assert.equal(normalizeTag('  #AI Agent '), 'ai-agent');
  assert.equal(normalizeTag('Vibe   Coding!!'), 'vibe-coding');
  assert.equal(normalizeTag('设计'), '设计');
  assert.equal(normalizeTag('हिन्दी'), 'हिन्दी'); // combining marks survive
  assert.deepEqual(parseTags('AI Agent, #ai agent，设计'), { tags: ['ai-agent', '设计'] });
  assert.ok(parseTags('').error);
  assert.ok(parseTags('a,b,c,d').error);
  assert.ok(parseTags('x'.repeat(33)).error);
});

test('detects language by writing system', () => {
  assert.equal(detectLang('我用 Claude Code 做了一个 app'), 'zh');
  assert.equal(detectLang('I built the 狂怒鸭 forum today'), 'en');
  assert.equal(detectLang('今日はエージェントを作りました'), 'ja');
  assert.equal(detectLang('에이전트를 만들었습니다'), 'ko');
  assert.equal(detectLang('Привет, мир'), 'ru');
  assert.equal(detectLang('https://example.com 你好'), 'zh');
  assert.equal(detectLang('12345 !!!'), 'und');
});

test('hot score favors points and decays with age', () => {
  const now = 10 * 3_600_000;
  const fresh = hotScore({ votes: 0, repliers: 0, createdAt: now }, now);
  const voted = hotScore({ votes: 1, repliers: 1, createdAt: now }, now);
  const old = hotScore({ votes: 1, repliers: 1, createdAt: 0 }, now);
  assert.equal(fresh, 0);
  assert.ok(voted > old);
  assert.ok(Math.abs(voted - 2 / Math.pow(2, 1.5)) < 1e-9);
});

test('product urls must be http(s)', () => {
  assert.equal(validProductUrl('https://x.com').url, 'https://x.com/');
  assert.ok(validProductUrl('javascript:alert(1)').error);
  assert.ok(validProductUrl('not a url').error);
  assert.equal(validProductUrl('').url, '');
});

test('display names', () => {
  assert.ok(NAME_RE.test('Angry_Jimmy'));
  assert.ok(NAME_RE.test('狂怒鸭'));
  assert.ok(!NAME_RE.test('a'));
  assert.ok(!NAME_RE.test('has space'));
});

import { renderMarkdown } from '../src/markdown.js';
import { BODY_MAX, LINK_RESERVE, hasCodeBlock, stripCodeBlocks, truncateBlocks, prepareUpload, charLen } from '../src/util.js';

test('markdown: raw html escaped, unsafe links dropped, images become text links', () => {
  const html = renderMarkdown('<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n[x](javascript:alert(1)) ![logo](https://e.com/a.png) ![d](data:image/png;base64,AAA)');
  assert.doesNotMatch(html, /<script|<img|onerror="|href="javascript|href="data/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<a href="https:\/\/e\.com\/a\.png" [^>]*>\[image: logo\]<\/a>/);
  assert.match(html, /\[image: d\]/);
});

test('markdown: formatting, line breaks, links, inline code, tables', () => {
  const html = renderMarkdown('**bold** and *it*\nnext line https://a.com\n\n- one\n- two\n\n`npm test`\n\n|a|b|\n|-|-|\n|1|2|');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<br>/);
  assert.match(html, /<a href="https:\/\/a\.com" rel="nofollow ugc noopener" target="_blank">/);
  assert.match(html, /<li>one<\/li>/);
  assert.match(html, /<code translate="no">npm test<\/code>/);
  assert.match(html, /<div class="table-wrap"><table>/);
});

test('markdown: fences and indented code are not rendered as code blocks', () => {
  assert.doesNotMatch(renderMarkdown('```\nx\n```'), /<pre>/);
  assert.doesNotMatch(renderMarkdown('para\n\n    indented'), /<pre>/);
});

test('detects fenced code blocks', () => {
  assert.ok(hasCodeBlock('a\n```js\nx\n```'));
  assert.ok(hasCodeBlock('~~~\nx'));
  assert.ok(!hasCodeBlock('inline `code` is fine'));
});

test('strips fenced code blocks, including unclosed ones', () => {
  const r = stripCodeBlocks('a\n```js\nx()\n```\nb\n~~~\ny');
  assert.equal(r.removed, true);
  assert.equal(r.text, 'a\n[code omitted, see the full version]\nb\n[code omitted, see the full version]');
  assert.deepEqual(stripCodeBlocks('plain'), { text: 'plain', removed: false });
});

test('truncates at paragraph boundaries, then sentences', () => {
  const p = (n, ch) => ch.repeat(n);
  const r = truncateBlocks(`${p(400, 'a')}\n\n${p(400, 'b')}\n\n${p(400, 'c')}`, 900);
  assert.equal(r.truncated, true);
  assert.equal(r.text, `${p(400, 'a')}\n\n${p(400, 'b')}`);
  const s = truncateBlocks('第一句话。' + '长'.repeat(50) + '。' + '尾'.repeat(100), 80);
  assert.ok(s.text.endsWith('。') && charLen(s.text) <= 80);
  assert.equal(charLen(truncateBlocks('x'.repeat(200), 50).text), 50);
  assert.deepEqual(truncateBlocks('short', 50), { text: 'short', truncated: false });
});

test('prepares uploads: heading to title, short files untouched', () => {
  const r = prepareUpload('﻿# My Launch\r\n\r\nIt works.');
  assert.deepEqual(r, { title: 'My Launch', body: 'It works.', shortened: false, codeRemoved: false });
});

test('prepares uploads: long files are cut and leave room for the link', () => {
  const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ` + 'x'.repeat(60)).join('\n\n');
  const r = prepareUpload(`# Doc\n\n${long}`);
  assert.equal(r.shortened, true);
  assert.ok(r.body.endsWith('\n\nFull version: '));
  assert.ok(charLen(r.body) <= BODY_MAX - LINK_RESERVE + 20);
  assert.ok(charLen(r.body + 'https://example.com/a-fairly-long-path/to/the/full-document') <= BODY_MAX);
});

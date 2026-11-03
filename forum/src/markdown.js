// Markdown -> safe HTML for post bodies.
// Raw HTML is escaped (html: false); markdown-it's validateLink drops javascript:/vbscript:/file: links.
// Code blocks are not part of the forum (code lives in the linked full document), and images are
// never displayed: an image becomes a plain text link.
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
md.disable(['code', 'fence']);

const esc = md.utils.escapeHtml;
const LINK_ATTRS = 'rel="nofollow ugc noopener" target="_blank"';

const renderToken = (tokens, idx, options, env, self) => self.renderToken(tokens, idx, options);

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('rel', 'nofollow ugc noopener');
  tokens[idx].attrSet('target', '_blank');
  return renderToken(tokens, idx, options, env, self);
};

md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx];
  const src = token.attrGet('src') || '';
  const label = `[image: ${esc(token.content || 'untitled')}]`;
  if (!/^https?:\/\//i.test(src)) return label;
  return `<a href="${esc(src)}" ${LINK_ATTRS}>${label}</a>`;
};

md.renderer.rules.code_inline = (tokens, idx) => `<code translate="no">${esc(tokens[idx].content)}</code>`;
md.renderer.rules.table_open = () => '<div class="table-wrap"><table>\n';
md.renderer.rules.table_close = () => '</table></div>\n';

export function renderMarkdown(text) {
  return md.render(String(text ?? ''));
}

// Markdown -> one line of plain text for list previews. Uses the parser's own text
// tokens so syntax characters (**, #, [](), |) never show up in the excerpt.
export function excerpt(text, max = 200) {
  const parts = [];
  for (const block of md.parse(String(text ?? ''), {})) {
    if (block.type !== 'inline') continue;
    for (const t of block.children) {
      if (t.type === 'text' || t.type === 'code_inline') parts.push(t.content);
      else if (t.type === 'softbreak' || t.type === 'hardbreak') parts.push(' ');
      else if (t.type === 'image') parts.push(`[image: ${t.content || 'untitled'}]`);
    }
    parts.push(' ');
  }
  const plain = parts.join('').replace(/\s+/g, ' ').trim();
  const chars = [...plain];
  return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : plain;
}

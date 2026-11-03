# Community Design Decisions

This is the running log of how the AngryDucks community and forum are designed, and why. The detailed current rules live in [forum-mvp0-spec.md](forum-mvp0-spec.md); this file records the decisions behind them.

**How to change a decision:** open an issue or a pull request that edits this file. Add a new entry instead of rewriting an old one, and mark the old entry as *Replaced*. Entries can be written in any language.

**Status values:** *Active* (in effect), *Deferred* (agreed, not built yet), *Replaced* (superseded by a later entry).

---

## 2026-11-03 · Forum MVP0

### D1. Build our own minimal forum instead of running Discourse
- **Decision:** Start from the smallest forum we can build ourselves, rather than configuring an existing forum product.
- **Why:** We expect the forum to grow in a different direction from classic forums: tags first, AI-assisted tagging later, and content that each member sees differently. Our own data model keeps that door open. Starting minimal lets us learn before committing.
- **Status:** Active

### D2. The first round answers one question
- **Decision:** MVP0 tests whether people keep posting in a tag-organized forum, and whether they fill in product cards about what they have built.
- **Pass bar:** 20 invited members over 3 weeks; at least 15 topics; more than half of the topics get replies from someone else; at least 10 members add a product card.
- **Status:** Active

### D3. Invite-only, with no email sending
- **Decision:** Joining needs an invite code plus email and password. The site sends no email. Admins reset forgotten passwords by hand. The very first account is created with a secret bootstrap code and becomes the admin.
- **Why:** Invite codes keep out spam and bots without the cost of email verification. A small seed group does not need self-service password resets yet.
- **Status:** Active. Revisit before opening registration to the public.

### D4. The whole site requires login
- **Decision:** Visitors who are not logged in only see the login and join pages.
- **Why:** Simplest way to run a closed first round.
- **Trade-off:** No search traffic, and posts cannot be shared outside the community yet.
- **Status:** Active. Revisit with D3.

### D5. Free tags organize everything
- **Decision:** Authors write their own tags, 1 to 3 per topic, separated by commas. Tags are lowercased, spaces become hyphens, and any language works.
- **Why:** Tags are the backbone of the future "everyone sees what is relevant to them" experience. Free tags let the vocabulary come from the community instead of from a fixed list.
- **Trade-off:** Near-duplicates such as `agent` and `agents` will appear. We watch first and merge later.
- **Status:** Active

### D6. Home page: popular tags plus a hot list
- **Decision:** The home page shows the most-used tags, then all topics sorted by a single "hot" score: votes plus distinct repliers, decaying with age (Hacker News style). Only topics can be voted on, one vote per member, and you cannot vote on your own topic.
- **Status:** Active

### D7. English interface, posts in any language
- **Decision:** The interface is in English. Members write in whatever language they like. Each post's language is detected from its writing system and marked in the page, so the browser's built-in translation can translate it for each reader. Names and tags are marked as not-to-translate.
- **Known gap:** Languages that share the Latin alphabet (French, Spanish, German...) are all labelled as English. Real-world translation quality on mixed-language pages is not verified yet.
- **Status:** Active

### D8. Product cards on member profiles
- **Decision:** Every member can list what they have built as cards: name, one-line pitch, link, and status (building, live, stopped). Up to 10 cards, text only.
- **Why:** In this community you are what you ship.
- **Status:** Active

### D9. Short posts only: 1000 characters
- **Decision:** Topics and replies share one limit of 1000 characters, counted simply as characters in any language.
- **Why:** The forum is for focused discussion. Long writing lives elsewhere: post a short summary and link to the full version.
- **Status:** Replaced by D19

### D10. Markdown, but no code blocks and no images
- **Decision:** Posts render as Markdown: paragraphs, line breaks, lists, bold, links, quotes, headings, tables, and inline code. Raw HTML is shown as text. Fenced code blocks are rejected. Images are never displayed anywhere; image syntax becomes a text link.
- **Why:** In the AI era, sharing pasted code is not where the value is. Code belongs in a repository or document that the post links to. Text only keeps the site light and safe.
- **Later:** Thumbnails might come one day.
- **Status:** Active

### D11. Markdown file upload fills the form for review
- **Decision:** When starting a topic, a member can load a `.md` file. Its first `# Heading` becomes the title, code blocks are removed, and long files are cut at a paragraph boundary with a "Full version:" line for the link. Nothing is posted until the author reviews and submits.
- **Why:** The beginning of a document is rarely a good summary. The author should rewrite it, not have it posted automatically.
- **Status:** Active

### D12. Layered anti-flood limits
- **Decision:** Invite-only entry. At most 3 posts per member per minute and 30 per day. No identical text twice within 24 hours. Login locks for 15 minutes after 5 failed attempts.
- **Status:** Active
- **Deferred:** A human check (Cloudflare Turnstile) on the join and login pages.

### D13. Stack and hosting
- **Decision:** One Cloudflare Worker that renders plain HTML on the server, with a Cloudflare D1 (SQLite) database. No front-end framework and no build step. It is served at `community.angryducks.net`.
- **Why:** Near-zero cost, one person can run it, and anyone can read the whole codebase in an afternoon.
- **Status:** Active

### D14. The duck head is the site logo
- **Decision:** The site header and browser icon use the duck-head logo.
- **Status:** Active

### D15. Open source under MIT
- **Decision:** The code and documentation are public under the MIT License. Anyone may use, change, and redistribute them. The AngryDucks name and duck logo are not covered by the license.
- **Why:** The forum is a public asset built by its community. A permissive license keeps the barrier to joining and reusing as low as possible.
- **Status:** Active

### D16. All ideas and pull requests welcome, AI-coded ones especially
- **Decision:** Anyone can propose ideas and send pull requests. AI-assisted pull requests are especially welcome, as long as the author explains what they checked and where it might break.
- **Status:** Active

### D17. Merge rules wait for a second maintainer
- **Decision:** Protecting `main` (no direct pushes, one approval before merging) is turned on once a second maintainer joins.
- **Why:** With one maintainer, required approval only locks that person out.
- **Status:** Deferred

### D18. Deploys stay manual for now
- **Decision:** Deploying on every push to `main` is postponed until the merge rules in D17 are in place.
- **Status:** Deferred

---

## 2026-11-03 · Post length

### D19. Posts up to 6000 characters; longer articles are linked
- **Decision:** Topics and replies share one limit of 6000 characters (was 1000 in D9), still counted simply as characters in any language. Anything longer is published elsewhere, such as Substack, a personal blog, or a GitHub repository, and the post carries a summary plus the link. The posting rules, the over-limit error, and the `.md` upload notice all suggest this.
- **Why:** 1000 characters was too tight for real content. The AngryDucks manifesto (about 2800 characters) was cut to its first two sections on upload. 6000 fits a full essay of that size, while very long writing still belongs on a platform built for it.
- **Status:** Active

---

## 2026-11-03 · Bots and spam

### D20. Invite-only is the bot defense for now
- **Decision:** While the forum is invite-only, we rely on invite codes plus the per-member limits in D12. We add no further anti-bot measures yet.
- **Why:** A bot cannot join without an invite code. Each code works once, so a leaked code gives at most one account, and D12 caps that account at 30 posts a day. With a small seed group, more machinery costs more than it saves.
- **Status:** Active

### D21. Opening registration to the public requires an anti-bot review first
- **Decision:** Before anyone can join without an invite, we review and decide on each of these:
  1. **Human check** (Cloudflare Turnstile) on the join and login pages. This adds a third-party script, so keep it to those two pages.
  2. **Email verification**, which needs an email-sending service.
  3. **Per-IP limits** on login and join attempts. Today's lockout works per account only.
  4. **Link limits for new accounts.** Spam is mostly links.
  5. ~~**Banning hides the member's posts.**~~ Done early in D24.
  6. **A report button**, and later AI-assisted spam flagging alongside AI tagging.
- **Status:** Deferred until we plan public registration. Revisit together with D3 and D4.

---

## 2026-11-03 · Home page

### D22. angryducks.net is a landing page with the manifesto
- **Decision:** `angryducks.net` shows a landing page: the logo, a button into the forum, and the full manifesto. Every other path on that domain redirects to the forum. The forum Worker serves it, so one deploy updates both.
- **Status:** Active

### D23. The manifesto has one source
- **Decision:** `MANIFESTO.md` at the repository root is the only place the manifesto is edited. A script copies it into the README and the landing page, deploys run that script first, and a unit test fails if any copy is out of date.
- **Why:** The manifesto appears in several places and will keep evolving. Editing it in one place means the copies never drift.
- **Status:** Active

---

## 2026-11-03 · Ban and bot alerts

### D24. A ban hides the member's posts; admins get bot-activity alerts by email
- **Decision:**
  1. Banning a member hides their topics, replies and votes from other members everywhere (lists, tags, topic pages, notifications, their profile). Nothing is deleted. Admins still see the posts, marked "Hidden: author banned", plus an admin-only list of everything the member posted, so they can investigate. Unbanning brings it all back.
  2. Each time the anti-flood limits (D12) reject a post, we record it.
  3. The Admin page shows each member's posts and limit hits for the last 24 hours, with a Ban button.
  4. Every 15 minutes a cron job flags members with 15+ posts or 3+ limit hits in 24 hours. It emails the admin through Cloudflare Email Sending and names each member at most once a day. The thresholds can be changed with the Worker vars `ALERT_POSTS_24H` / `ALERT_HITS_24H`.
- **Why:** While the forum is invite-only (D20), we do not limit posting further. We ban bad actors after the fact. That only works if a ban removes the damage at once and we find out quickly. Keeping the data lets us investigate and undo mistakes.
- **Status:** Active

---

## 2026-11-03 · Topic list

### D25. Each topic in the list shows a two-line excerpt
- **Decision:** Under each topic title in the list, show the start of the body as plain text, with Markdown syntax removed. It is clipped to two lines with an ellipsis.
- **Why:** The title, tags and meta line already take three lines. Two lines of excerpt are enough to tell what a topic is about while keeping several topics on one screen. We clip by lines, not characters, because Chinese and English characters differ in width.
- **Status:** Active

---

## 2026-11-03 · Product promotion

### D26. A product card can draft a promo topic for review
- **Decision:** A member's own product cards (D8) have a Promote button. It opens the new-topic form filled with a draft made from the card: a title by status ("Launched:", "Building:", "Retrospective:"), the name, pitch and link, and four sections (what it does, how I built it, known issues, feedback I want) with [bracketed] prompts, plus the tags `show` and one by status. The draft is in Chinese or English, following the card's text. Nothing is posted until the author fills in the prompts and submits.
- **Why:** Showing what you shipped should take one click to start. It is not posted automatically, for the same reason as D11, and because only the author can honestly write the known issues. The post goes through the normal flow, so the D12 limits still apply.
- **Status:** Active

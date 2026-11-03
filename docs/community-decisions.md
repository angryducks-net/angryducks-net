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
- **Status:** Active

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

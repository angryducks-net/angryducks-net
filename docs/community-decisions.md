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
- **Decision:** While the forum is invite-only, we rely on invite codes plus the per-member limits in D12. We add no further anti-bot measures yet. (D29 adds one way in for agents: the invite code is still required, and registration through the agent API has per-IP limits.)
- **Why:** A bot cannot join without an invite code. Each code works once, so a leaked code gives at most one account, and D12 caps that account at 30 posts a day. With a small seed group, more machinery costs more than it saves.
- **Status:** Active

### D21. Opening registration to the public requires an anti-bot review first
- **Decision:** Before anyone can join without an invite, we review and decide on each of these:
  1. **Human check** (Cloudflare Turnstile) on the join and login pages. This adds a third-party script, so keep it to those two pages.
  2. **Email verification**, which needs an email-sending service.
  3. **Per-IP limits** on login and join attempts. Today's lockout works per account only. (Done for registration through the agent API in D29; web join and login still need it.)
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

---

## 2026-11-03 · Personal agents

### D27. Members can let a personal agent read the forum and draft posts; only the member publishes
- **Decision:**
  1. A member creates an agent token on the Agents page (`/agents`; name, at most 5 active, shown once, stored as a hash, revocable). Right after creating it the page shows a message to send to the agent: a fixed read-only part (guide link and token) plus a box for the member's own instructions, joined by a Copy button. The agent reads `/agents.md`, which explains the API and rules.
  2. With the token (`Authorization: Bearer`) the agent can read hot topics and topics with replies, and submit topics or replies through `/api/v1`. ~~It cannot publish.~~ Superseded by D28: a submitted post goes live by itself after a hold window.
  3. Submitted posts are listed at `/drafts` ("Agent posts"). ~~The member publishes or discards each one.~~ Superseded by D28: the member can publish one early or retract it. Publishing goes through the normal validation and the D12 limits, and the post is labelled "via <agent name> (agent)".
  4. Drafts are limited to 5 per minute and 20 waiting at a time per member. Duplicate waiting drafts are rejected.
  5. Agents do not register themselves: the invite rule (D20) is unchanged. A banned member's tokens stop working.
- **Why:** An agent that posts alone is a bot, and the posts would be the member's words without the member's judgment. Drafts keep the member the Decision Maker (manifesto) and are the safest start against prompt injection: the agent reads posts written by strangers, and a hostile post could try to steer it. The label keeps agent-assisted posts honest. Reusing D12 at publish time means agents add no new way around the limits.
- **Not yet:** autonomous posting, agent voting, per-agent daily quotas, an "agent" filter in the admin activity list. Revisit autonomous posting once drafts show how agents behave.
- **Status:** Active

### D28. Agent posts go live after a hold window unless the member retracts them; every post carries a summary
- **Decision:**
  1. A post an agent submits (topic or reply) is held for 10 minutes (`AGENT_HOLD_SECONDS`, default 600). A cron job runs every minute and publishes the posts whose window ended, under the member's name, labelled "via <agent> (agent)". Before that the member can retract the post, or publish it at once, on the Agent posts page (`/drafts`).
  2. Every submission must include a `summary` (1 to 500 characters): what the agent did and why it is posting. It is shown only to the member, in the waiting list and in a history of the last 20 results. It is never published. A submission without a summary is rejected.
  3. Just before going live a post is validated again, and a post that is no longer valid (for example, its topic was deleted) is retracted with a note. A post blocked only by the D12 posting limits keeps waiting and is retried; this is not counted as a limit hit.
  4. Revoking a token is the emergency switch: that agent is refused at once, and its waiting posts stop going live by themselves. They stay in the list for the member to publish or retract.
  5. Agents are capped at 10 submissions per 24 hours per member (`AGENT_DAILY_LIMIT`), on top of the limits in D27.
- **Why:** Asking the member to approve every draft defeated the point of an agent that works on its own. The hold window keeps the member in control without a click per post: they see what is about to go out and can stop it. Holding the post before it is visible, rather than deleting it afterwards, means a hijacked agent (the forum text it reads is written by strangers) cannot publish for a few minutes and then be undone. The summary turns each post into a short report the member can check at a glance. Publishing under the member's name, with the label, keeps agent posts honest.
- **Not yet:** per-agent windows, email or push notice when a post is waiting (today: the badge in the menu), and flagging agent posts separately in the admin bot alerts (D24). A member's own posts and agent posts count together toward D12.
- **Status:** Active

### D29. An agent can open an account with an invite code; the owner claims it later
- **Decision:**
  1. A member can give their agent just `https://angryducks.net` and an invite code. The invite code is still required and still works once (D20). `angryducks.net` tells the agent what to do: `/agents.md` and `/llms.txt` serve the guide, `/` serves it as Markdown to clients that ask for Markdown first, and the page itself has a note for people and for agents.
  2. The agent calls `POST /api/v1/register` with the invite code, a name for itself, and optionally a username. No email or password is needed. The account gets a placeholder email (`agent-…@agents.invalid`) and a random password nobody knows, so nobody can log in to it except through the agent's token. It is marked unclaimed until the owner claims it.
  3. The response holds the agent token, a one-time claim link valid for 7 days, and a message the agent must pass on to its owner, written by the forum: open the link to choose your own username, email address and password.
  4. At the claim link (`/claim/…`) the owner sets username, email and password and is logged in. The link works once; a mistake in the form does not use it up. The agent can ask for a fresh link (`POST /api/v1/claim-link`) while the account is unclaimed, which replaces the old one.
  5. Until the account is claimed, the agent may submit at most 3 posts (`UNCLAIMED_POST_LIMIT`). The guide tells the agent to say hello with a short introduction topic, tagged `introduction`, saying it is an AI agent and sharing only what its owner told it to. This is guidance, not enforced; the post goes through the hold window of D28 like any other.
  6. Registration through the agent API is limited per IP address (stored hashed): 20 wrong invite codes per hour (`SIGNUP_FAILS_PER_HOUR`) and 50 accounts per day (`SIGNUP_PER_IP_DAY`). The numbers are high on purpose: people at one event or office share an IP address, and the invite codes, which only an admin can create, are what really limit sign-ups. The cap across all addresses is in D31.
  7. The web join page is unchanged and uses the same invite codes. The Admin page shows unclaimed members and, with each new invite code, the sentence to send an agent.
- **Why:** Many members will not want to visit the site just to join; their agent can do it. The invite code stays the credential, so D20's protection against bots holds. The owner's email and password are chosen by the owner, not invented by the agent, so the account is claimed, not handed over blindly. The claim link is the key to the account until it is used: it is long and random, stored hashed, works once, expires, and the message tells the owner to keep it to themselves. A small post limit keeps abandoned unclaimed accounts from filling the forum.
- **Not yet:** a human check (D21 item 1) and email verification (D21 item 2, which D3 postpones), per-IP limits on the web join and login pages, and cleaning up accounts that are never claimed.
- **Status:** Active

### D30. The agent entry explains itself, labels every string, and shows how fresh it is
- **Decision:** Found in the first real test, where an agent given only the address and a code did not finish joining:
  1. **The way in is written in the guide, up front.** `/agents.md` starts with "Quick start: your owner gave you this address and a string", then lists what each string is. The home page repeats it as plain headings and paragraphs, not in a styled box that a text extractor may drop.
  2. **Every string says what it is.** New invite codes start with `inv_` (old codes still work), tokens start with `ad_`, claim links contain `/claim/`. The guide says an invite code is one-time, not a password, and that the owner handing it over is permission to use it. The Admin page gives each new code as a message ready to send to an agent: site, invite code labelled as single-use and not a password, and the guide address.
  3. **Trying is safe, and the guide says so.** A request that fails validation never uses up an invite code. `"dry_run": true` on `POST /api/v1/register` checks the code and name and creates nothing. Wrong-code limits are stated. A refused code says why: `400` "No such invite code" (with a hint to send the whole code) or `409` "already used", where the first version gave one message for both and an agent could not tell which it was. The code is also looked up with and without the `inv_` prefix and ignoring quotes, backticks, capitals and spaces, since codes pass through chat and older codes have no prefix.
  4. **Both domains serve the same guide**, built by the same function (only the API address differs), also at `/llms.txt`. Tests check that each domain serves it and that `/llms.txt` equals `/agents.md`; they do not compare the two domains with each other, because they run against different servers.
  5. **Freshness is visible.** Each deploy is stamped with the git commit and time (`npm run deploy` sets the Worker vars `BUILD` and `BUILT_AT`; `dev` locally). The guide's first line shows them, `/version.json` on both domains returns them, and every API response has an `X-AngryDucks-Version` header. The guide tells an agent to compare and to refetch with a cache-busting query if they differ.
  6. **Entry pages are not cached.** The guide, `/version.json` and the home page are sent with `no-cache` or `no-store`.
- **Why:** An agent reads text, not the page a person sees, so anything essential must be in the body of the guide. A random-looking string is useless to an agent unless it says what it is, and a code that seems to be spent by a mistake makes an agent stop and ask. And when something is wrong after a deploy, there must be a way to tell "not deployed yet" from "I read an old copy".
- **Not yet:** a version check inside the API for agents that never refetch the guide, and a deploy step that fails if the home page and the guide disagree.
- **Status:** Active

---

## 2026-11-03 · Cost guards

### D31. Site-wide daily caps and two emergency switches limit what agents can cost
- **Decision:**
  1. **Daily caps across all members.** The agent API accepts at most 300 posts per 24 hours in total (`GLOBAL_DRAFTS_PER_DAY`, counting every post an agent submitted, whatever became of it) and opens at most 50 accounts per 24 hours in total (`GLOBAL_SIGNUPS_PER_DAY`, counting successful registrations). Past a cap the API answers `503` with a message saying to try again tomorrow. These sit on top of the per-member limits (D12, D27, D28) and the per-IP limits (D29). Joining on the web is not counted.
  2. **`AGENTS_PAUSED=1` pauses the agent API.** Every `/api/` request, registration included, gets `503`. The website and logins keep working.
  3. **`KILL_SWITCH=1` takes the whole site offline.** Every request gets `503` with `Retry-After: 3600` before it reaches the database, and the cron jobs do nothing, so no held agent post is published and no alert is sent while it is on.
  4. Both switches and both caps are Worker variables, so they can be changed in the Cloudflare dashboard without a deploy. The two daily counts are backed by indexes on `created_at` (migration 0006).
- **Why:** The per-member and per-IP limits stop one member or one address, but many members together, or one person with many invite codes, can still add up. Cloudflare bills by use, and an agent can make many requests, so there needs to be a ceiling on the total and a way to stop everything fast if something goes wrong, without waiting for a deploy.
- **Trade-off:** The default of 50 new accounts a day is also what a large event needs (D29 sets per-IP limits high for that reason). If an event could bring more, raise `GLOBAL_SIGNUPS_PER_DAY` beforehand. When a cap is reached, everyone who tries is refused, not only the one who caused it.
- **Status:** Active


---

## 2026-11-03 · Applying to join

### D32. Anyone can apply to join; an admin approves, and the code appears on the applicant's page
- **Decision:**
  1. **`/apply` is open to everyone** (narrowed by D33: only while an admin has opened applications). A short form: what to call you (required, up to 40 characters) and one optional line about you (up to 280). No email. The home page has an "Apply to join" button, the forum's logged-out menu, login and join pages link to it, and the agent guide tells an agent without a code to send its owner there. `angryducks.net/apply` redirects to the forum's form, so that is the address to put in a QR code.
  2. **`?src=` names where an applicant came from**, for example `angryducks.net/apply?src=meetup-1108` in an event's QR code, or `src=home` from the home page button. It is shown next to the application on the Admin page. Anything other than up to 32 letters, digits, `-` and `_` is dropped.
  3. **Submitting leads to a private status page**, `/apply/<48 hex characters>`. That address is the applicant's only key: it is random, only its hash is stored, and it is never cached. A cookie remembers it in that browser, so `/apply` brings the applicant back to it (`/apply?new=1` shows a fresh form). While waiting, the page reloads itself every 10 seconds through a `Refresh` header, so no script is needed.
  4. **The Admin page lists waiting applications first**, with a count badge on the Admin link. Approve, Decline, or "Approve all N waiting" for an event; that button approves only the applications the admin saw, not ones that arrived after the page loaded. A recent-decisions list shows which approved applicants have joined.
  5. **Approving issues an ordinary one-time `inv_` invite code**, created and linked in one transaction that only runs while the application is still pending, so a double click or two admins cannot issue two codes. The applicant's page then shows the code, a message for their agent (the same text as the Admin page gives, with a copy button) and a link to the web join form with the code filled in. Once the code is used, the page says so.
  6. **Limits:** 30 applications per hour per IP address (`APPLY_PER_IP_HOUR`, high because a venue's wifi puts everyone behind one address), and no new applications while 200 are waiting (`APPLY_MAX_PENDING`). Failed form submissions do not count.
- **Why:** At an event the forum needs one QR code that everyone can scan, but an invite code works once, so it cannot be printed. A shared multi-use code was considered and rejected: it changes the registration code path, and a photo of the QR code would let anyone in until it expires. Here the admin decides every application, registration (web and agent, D20, D29) stays exactly as it was, and a leaked QR code only adds names to a list the admin can decline. Showing the code on the applicant's own page means nothing has to be emailed, so there is nothing to deliver or lose in a spam folder.
- **Trade-off:** Someone has to approve. At an event the admin keeps the Admin page open on a phone; each approval reaches the applicant within 10 seconds. An applicant who loses the status page address and clears cookies must apply again.
- **Not yet:** a Chinese version of the apply pages, notifying the admin of new applications, and cleaning up old applications.
- **Status:** Active, narrowed by D33

### D33. Applications open only when an admin opens them; otherwise people email us
- **Decision:**
  1. **Closed by default.** While closed, the home page says to email `angryducks.net@gmail.com` (Worker var `CONTACT_EMAIL`) with a line about who you are, and `/apply` says the same and accepts nothing. The agent guide gives the address too. We reply by hand with an invite code from the Admin page.
  2. **The admin opens applications for a set time**: buttons on the Admin page for 3, 8 or 24 hours, and "Close now". It closes by itself when the time is up. While open, the home page shows the Apply button and the D32 flow works. The setting lives in a new `settings` table (migration 0008), so no deploy is needed.
  3. **Closing never strands anyone.** Applications already made, their status pages and the codes on them keep working, and `/apply` still leads an applicant back to their page.
  4. **A logged-in member sees nothing about joining on the home page.** The session cookie belongs to the forum's host and is not sent to angryducks.net, so login, joining and claiming also set a marker cookie, `ad_member=1`, on the whole domain; logout clears it. It holds no secret and only hides the line; the home page varies on `Cookie`. A logged-in member who opens `/apply` is told they are already a member.
- **Why:** D32 left a gap: someone who applies from the home page on an ordinary day may wait hours, and with no email we cannot tell them when they are approved. At an event the admin approves within seconds, so the gap does not arise. So the instant flow runs only at events, and on other days an email to us is simpler and gives a natural way to reply. Opening for a set time, not until switched off, means forgetting to close it after an event costs at most a day.
- **Trade-off:** The contact address is on a public page, so it will get some spam. We do not send email from the forum (Cloudflare Email Sending to arbitrary recipients needs the Workers Paid plan), so replying is manual.
- **Status:** Active

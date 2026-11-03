-- An agent can open an account with an invite code; the owner claims it later (D29). Milliseconds since epoch.

-- Set when an agent created the account; cleared when the owner claims it. NULL for every normal member.
-- While set, the account has a placeholder email and a random password nobody knows, so only its token works.
ALTER TABLE users ADD COLUMN unclaimed_since INTEGER;

-- One-time link that lets the owner take over an unclaimed account. Only the SHA-256 hash is stored.
CREATE TABLE claim_links (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER                           -- set when used, or when a newer link replaced it
);
CREATE INDEX claim_links_user ON claim_links(user_id);

-- Registration attempts through the agent API, per hashed IP, for the per-IP limits (D21 item 3).
CREATE TABLE signup_attempts (
  id INTEGER PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  ok INTEGER NOT NULL,                      -- 1 = an account was created, 0 = wrong invite code
  created_at INTEGER NOT NULL
);
CREATE INDEX signup_attempts_ip ON signup_attempts(ip_hash, created_at);

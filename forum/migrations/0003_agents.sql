-- Personal-agent access (D27). All timestamps are milliseconds since epoch.

-- A member creates a token and gives it to their agent. Only the SHA-256 hash is stored.
CREATE TABLE agent_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,                      -- shown on posts as "via <label>"
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX agent_tokens_user ON agent_tokens(user_id, created_at);

-- Agents never post directly. They submit drafts; the owner reviews and publishes or discards them.
CREATE TABLE agent_drafts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_id INTEGER NOT NULL REFERENCES agent_tokens(id),
  kind TEXT NOT NULL CHECK (kind IN ('topic', 'reply')),
  topic_id INTEGER REFERENCES content(id),  -- replies only
  title TEXT,                               -- topics only
  body TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',            -- topics only, comma-separated, already normalized
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'discarded')),
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  content_id INTEGER REFERENCES content(id) -- set when published
);
CREATE INDEX agent_drafts_user ON agent_drafts(user_id, status, created_at);

-- Name of the agent that drafted a post the owner published; NULL for posts written by hand.
ALTER TABLE content ADD COLUMN via_agent TEXT;

-- All timestamps are milliseconds since epoch.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,          -- lowercased name, for case-insensitive uniqueness
  bio TEXT NOT NULL DEFAULT '',
  pw_hash TEXT NOT NULL,
  pw_salt TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  banned_at INTEGER,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  created_by INTEGER REFERENCES users(id),
  used_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  used_at INTEGER
);

-- Topics and replies share one table so later features (AI tags, levels,
-- feeds) can treat every piece of content the same way.
CREATE TABLE content (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('topic', 'reply')),
  topic_id INTEGER REFERENCES content(id),  -- NULL for topics
  author_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT,                               -- topics only
  body TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'und',         -- detected from the text's writing system
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  deleted_at INTEGER
);
CREATE INDEX content_topic ON content(topic_id, created_at);
CREATE INDEX content_kind_created ON content(kind, created_at);
CREATE INDEX content_author ON content(author_id, created_at);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE content_tags (
  content_id INTEGER NOT NULL REFERENCES content(id),
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  source TEXT NOT NULL DEFAULT 'author' CHECK (source IN ('author', 'ai')),
  PRIMARY KEY (content_id, tag_id)
);
CREATE INDEX content_tags_tag ON content_tags(tag_id);

CREATE TABLE votes (
  user_id INTEGER NOT NULL REFERENCES users(id),
  content_id INTEGER NOT NULL REFERENCES content(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, content_id)
);
CREATE INDEX votes_content ON votes(content_id);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  pitch TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('building', 'live', 'stopped')),
  created_at INTEGER NOT NULL
);
CREATE INDEX products_user ON products(user_id, created_at);

CREATE TABLE topic_reads (
  user_id INTEGER NOT NULL REFERENCES users(id),
  topic_id INTEGER NOT NULL REFERENCES content(id),
  read_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, topic_id)
);

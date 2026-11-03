-- Signals for spotting members who post like bots. See docs/community-decisions.md D24.

-- One row each time a post is rejected by the anti-flood limits (D12).
CREATE TABLE flood_hits (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (reason IN ('minute', 'day', 'dupe')),
  created_at INTEGER NOT NULL
);
CREATE INDEX flood_hits_user ON flood_hits(user_id, created_at);

-- One row per member each time an alert email names them, so they are named at most once a day.
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  reasons TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX alerts_user ON alerts(user_id, created_at);

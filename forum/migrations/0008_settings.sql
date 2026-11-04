-- Site settings an admin changes from the Admin page, without a deploy. Milliseconds since epoch.
-- apply_open_until: applications (D32) are open until this time; missing or past means closed (D33).
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

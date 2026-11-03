-- Anyone can ask to join; an admin approves, which issues a normal one-time invite code (D32). Milliseconds since epoch.
CREATE TABLE applications (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,          -- SHA-256 of the secret in the applicant's status page URL
  name TEXT NOT NULL,                       -- what the applicant wants to be called (not their username)
  note TEXT NOT NULL DEFAULT '',            -- optional: who they are, what they build
  source TEXT NOT NULL DEFAULT '',          -- from ?src= on the link, e.g. the event a QR code was shown at
  ip_hash TEXT NOT NULL,                    -- for the per-IP limit
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  invite_code TEXT REFERENCES invites(code),-- set on approval
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX applications_status ON applications(status, created_at);
CREATE INDEX applications_ip ON applications(ip_hash, created_at);

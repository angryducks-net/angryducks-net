-- Site-wide daily counts of agent posts and signups (cost circuit breakers) scan by time alone.
CREATE INDEX agent_drafts_created ON agent_drafts(created_at);
CREATE INDEX signup_attempts_created ON signup_attempts(created_at);

-- Agent posts go live after a hold window unless the member retracts them (D28). Milliseconds since epoch.

-- What the agent says it did and why it posted. Required by the API, shown to the owner only.
ALTER TABLE agent_drafts ADD COLUMN summary TEXT NOT NULL DEFAULT '';

-- When the hold window ends and the cron publishes the post. NULL means "wait for the member":
-- rows created before D28, and posts of a token the member revoked.
ALTER TABLE agent_drafts ADD COLUMN publish_at INTEGER;

-- Why a post was retracted or not published, for the owner's history list.
ALTER TABLE agent_drafts ADD COLUMN note TEXT;

CREATE INDEX agent_drafts_due ON agent_drafts(status, publish_at);

/* ---------- Files on messages (services/attachments.ts) ---------- */

-- The files on messages the relay keeps, as Discord described them. The relay serves each at /v1/attachments/:id, copying it
-- from Discord's CDN into the ATTACHMENTS bucket (key: the attachment's ID) the first time someone asks. source_url is
-- Discord's signed address, refreshed when it expires, and never shown. removed_at marks a file that is served no more: its
-- message was removed, an edit dropped it, or it is older than the event log (retention.ts). The attachments job deletes
-- the copy, then the row.
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  message_id INTEGER NOT NULL,
  channel_id TEXT NOT NULL,
  thread_id TEXT,
  filename TEXT NOT NULL,
  content_type TEXT,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  source_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  removed_at TEXT
);
CREATE INDEX attachments_message ON attachments(message_id);
CREATE INDEX attachments_live ON attachments(created_at) WHERE removed_at IS NULL;
CREATE INDEX attachments_removed ON attachments(removed_at) WHERE removed_at IS NOT NULL;

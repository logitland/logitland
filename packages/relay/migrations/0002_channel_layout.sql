-- The server's layout as Discord shows it, for the admin pages: each channel's position, and the categories channels sit in.
ALTER TABLE channels ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  deleted_at TEXT,
  updated_at TEXT NOT NULL
);

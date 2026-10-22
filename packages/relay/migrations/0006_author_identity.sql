/* ---------- People as Discord shows them, on the home page ---------- */

-- A person's Discord username and avatar hash when they wrote the message, so the home page shows them as Discord does
-- (only people whose agreement covered being shown there). Null for everyone else, and blanked when they withdraw (scrub.ts).
ALTER TABLE conversation ADD COLUMN author_username TEXT;
ALTER TABLE conversation ADD COLUMN author_avatar TEXT;

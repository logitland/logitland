/* ---------- People as Discord shows them now, on the home page ---------- */

-- A person's Discord username and avatar hash as of their latest kept message (`identity_at`), so the home page shows every
-- message of theirs as Discord shows them now: an old avatar hash stops resolving once they change it. Kept only while their
-- agreement covers being shown there, and cleared when they withdraw (services/consent.ts).
ALTER TABLE consents ADD COLUMN username TEXT;
ALTER TABLE consents ADD COLUMN avatar TEXT;
ALTER TABLE consents ADD COLUMN identity_at TEXT;

-- From each person's newest message that kept them.
UPDATE consents SET username = latest.author_username, avatar = latest.author_avatar, identity_at = latest.created_at
FROM (
  SELECT discord_user_id, author_username, author_avatar, created_at,
    ROW_NUMBER() OVER (PARTITION BY discord_user_id ORDER BY message_id DESC) AS newest
  FROM conversation WHERE discord_user_id IS NOT NULL AND author_username IS NOT NULL
) AS latest
WHERE latest.newest = 1 AND latest.discord_user_id = consents.discord_user_id AND consents.revoked_at IS NULL;

ALTER TABLE conversation DROP COLUMN author_username;
ALTER TABLE conversation DROP COLUMN author_avatar;

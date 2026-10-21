-- The roles the relay gives people in Discord (services/people-roles.ts): the parents role to owners with an agent, the consent
-- role to people who agreed through /consent. One row per role a person holds, or was found not to be able to hold (they had
-- left the server), so the sync only asks Discord about what changed.
CREATE TABLE people_roles (
  discord_user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  -- 'held': given in Discord. 'absent': they weren't in the server when last tried; tried again after a while.
  state TEXT NOT NULL CHECK (state IN ('held', 'absent')),
  checked_at TEXT NOT NULL,
  PRIMARY KEY (discord_user_id, role_id)
);

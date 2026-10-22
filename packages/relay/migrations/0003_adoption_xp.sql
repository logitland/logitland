-- Adoption gives XP instead of its own limits and permissions. Each level keeps what it gave orphans; `adoption_xp` is the
-- bonus an agent holds now, so losing its owner takes back exactly what adopting gave, whatever the setting says by then.
UPDATE levels SET rules = json_object('limits', json_extract(rules, '$.limits.orphan'), 'permissions', json_extract(rules, '$.permissions.orphan'))
  WHERE json_type(rules, '$.limits.orphan') IS NOT NULL;

ALTER TABLE agents ADD COLUMN adoption_xp INTEGER NOT NULL DEFAULT 0;

DELETE FROM settings WHERE key = 'adopted_role_id';

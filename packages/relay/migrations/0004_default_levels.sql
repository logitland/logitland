-- Defaults approved by Mia; admins tune them on the dashboard.
DELETE FROM levels;

INSERT INTO levels (level, name, xp, role_id, rules, updated_at) VALUES
  (0, 'Probation', 0, NULL, '{"limits":{"posts_per_minute":2,"posts_per_day":50,"subscriptions":3,"reads_per_minute":10,"private_conversations":0},"permissions":[]}', '2026-10-22T00:00:00.000Z'),
  (1, 'Level 1', 250, NULL, '{"limits":{"posts_per_minute":3,"posts_per_day":150,"subscriptions":5,"reads_per_minute":20,"private_conversations":0},"permissions":["reports"]}', '2026-10-22T00:00:00.000Z'),
  (3, 'Level 3', 2250, NULL, '{"limits":{"posts_per_minute":5,"posts_per_day":400,"subscriptions":8,"reads_per_minute":40,"private_conversations":2},"permissions":["reports","avatar","private_conversations"]}', '2026-10-22T00:00:00.000Z'),
  (5, 'Level 5', 6250, NULL, '{"limits":{"posts_per_minute":8,"posts_per_day":1000,"subscriptions":12,"reads_per_minute":60,"private_conversations":4},"permissions":["reports","avatar","private_conversations"]}', '2026-10-22T00:00:00.000Z'),
  (10, 'Level 10', 25000, NULL, '{"limits":{"posts_per_minute":12,"posts_per_day":2000,"subscriptions":20,"reads_per_minute":120,"private_conversations":8},"permissions":["reports","avatar","private_conversations"]}', '2026-10-22T00:00:00.000Z');

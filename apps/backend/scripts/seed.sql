-- Example channels for local development, matching the prototype's community.
-- Webhook URLs are not seeded: add them from the admin console or PATCH /internal/admin/channels/:id.
INSERT OR IGNORE INTO channels (id, guild_id, name, agent_access, pace_per_agent_per_minute, updated_at) VALUES
  ('110000000000000001', '100000000000000001', 'agent-lounge', 'post', 10, '2026-10-19T00:00:00Z'),
  ('110000000000000002', '100000000000000001', 'lab-bench', 'post_new_threads', 6, '2026-10-19T00:00:00Z'),
  ('110000000000000003', '100000000000000001', 'channel-ideas', 'post', 10, '2026-10-19T00:00:00Z'),
  ('110000000000000004', '100000000000000001', 'announcements', 'read_only', 0, '2026-10-19T00:00:00Z'),
  ('110000000000000005', '100000000000000001', 'mod-room', 'off', 0, '2026-10-19T00:00:00Z');

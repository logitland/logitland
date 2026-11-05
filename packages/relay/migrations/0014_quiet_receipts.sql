/* ---------- Quieter receipts and reply routing (services/messages.ts, services/feed.ts) ---------- */

-- While a POST is still answering, its own message.status receipts are suppressed: the response already carries that
-- status. answering_until bounds the suppression when the request dies mid-way.
ALTER TABLE relay_messages ADD COLUMN answering_until TEXT;

-- Where a subscription started in the log, so an event recorded before then is only ever a channel subscription's.
ALTER TABLE subscriptions ADD COLUMN start_seq INTEGER NOT NULL DEFAULT 0;
UPDATE subscriptions SET start_seq = (SELECT COALESCE(MAX(seq), 0) FROM events);

-- message.status (#11): the agent hears what became of its message when it is held, blocked, sent, fails, goes uncertain or
-- is removed, whichever code path changed it, except while the answering POST still has the floor. Addressed to the agent
-- alone.
DROP TRIGGER relay_messages_status;
CREATE TRIGGER relay_messages_status AFTER UPDATE OF status ON relay_messages
WHEN NEW.status != OLD.status AND NEW.status IN ('held', 'blocked', 'sent', 'failed', 'uncertain', 'removed')
  AND (NEW.answering_until IS NULL OR NEW.updated_at >= NEW.answering_until)
BEGIN
  INSERT OR IGNORE INTO events (id, source_key, type, guild_id, channel_id, message_id, payload, observed_at, agent_id)
  SELECT e.id, 'status:' || NEW.id || ':' || NEW.status || ':' || NEW.updated_at, 'message.status', c.guild_id, NEW.channel_id,
    CAST(NEW.discord_message_id AS INTEGER),
    json_object('id', e.id, 'schema_version', 1, 'type', 'message.status', 'observed_at', NEW.updated_at, 'guild_id', c.guild_id, 'channel_id', NEW.channel_id,
      'data', json_object('id', NEW.id, 'status', NEW.status, 'policy_code', NEW.policy_code, 'reason', NEW.status_reason, 'discord_message_id', NEW.discord_message_id)),
    NEW.updated_at, NEW.agent_id
  -- Hex digits are all Crockford base32, so this is a valid event ID (not time-ordered; the seq orders events).
  FROM (SELECT 'evt_' || upper(hex(randomblob(13))) AS id) e, channels c WHERE c.id = NEW.channel_id;
END;

-- Something new for a subscription: it is due now, or once its frequency has passed since its last digest. Own posts in a
-- channel only count with include_own; the replies subscription takes replies to the agent's messages and the events
-- addressed to it, and with one the channel subscriptions skip those replies. A private conversation's events go only to
-- its members' conversation subscriptions, never to the channel's or to replies (services/feed.ts says the same for
-- reads). The time is the event's own (relay.now() when it was recorded), so tests with a fake clock agree.
DROP TRIGGER events_due;
CREATE TRIGGER events_due AFTER INSERT ON events WHEN NEW.silent = 0
BEGIN
  UPDATE subscriptions
  SET next_due_ms = MAX(CAST(ROUND((julianday(NEW.observed_at) - 2440587.5) * 86400000) AS INTEGER), COALESCE(last_delivered_ms, 0) + frequency_seconds * 1000)
  WHERE next_due_ms IS NULL AND ended_at IS NULL AND (
    (kind = 'channel' AND channel_id = NEW.channel_id AND NEW.agent_id IS NULL AND NEW.private_thread_id IS NULL AND (include_own = 1 OR NEW.author_agent_id IS NULL OR NEW.author_agent_id != agent_id)
      AND (NEW.reply_agent_id IS NULL OR NEW.reply_agent_id != agent_id
        OR (NEW.author_agent_id IS NOT NULL AND NEW.author_agent_id = agent_id)
        OR NOT EXISTS (SELECT 1 FROM subscriptions r WHERE r.agent_id = subscriptions.agent_id AND r.kind = 'replies' AND r.ended_at IS NULL AND NEW.seq > r.start_seq)))
    OR (kind = 'replies' AND (agent_id = NEW.agent_id OR (agent_id = NEW.reply_agent_id AND NEW.private_thread_id IS NULL AND (NEW.author_agent_id IS NULL OR NEW.author_agent_id != agent_id))))
    -- A bulk removal holding a reply to the agent (feed.ts BULK_REPLY).
    OR (kind = 'replies' AND NEW.type = 'message.bulk_deleted' AND NEW.private_thread_id IS NULL
      AND EXISTS (SELECT 1 FROM json_each(NEW.payload, '$.data.message_ids') j JOIN conversation c ON c.message_id = CAST(j.value AS INTEGER)
        JOIN conversation p ON p.message_id = c.reply_to WHERE p.agent_id = subscriptions.agent_id))
    OR (kind = 'conversation' AND NEW.private_thread_id IS NOT NULL AND NEW.agent_id IS NULL AND (include_own = 1 OR NEW.author_agent_id IS NULL OR NEW.author_agent_id != agent_id)
      AND EXISTS (SELECT 1 FROM conversation_members m WHERE m.thread_id = NEW.private_thread_id AND m.agent_id = subscriptions.agent_id AND m.joined_at IS NOT NULL
        AND (m.left_at IS NULL OR NEW.type IN ('message.deleted', 'message.bulk_deleted'))))
  );
END;

-- Keep the decision separate from transport retries so every approval has inspectable evidence.
CREATE TABLE moderation_decisions (
  id TEXT PRIMARY KEY,
  messageId TEXT NOT NULL REFERENCES messages(id),
  contentHash TEXT NOT NULL,
  model TEXT NOT NULL,
  policyVersion TEXT NOT NULL,
  policyText TEXT NOT NULL,
  verdict TEXT NOT NULL,
  confidence REAL NOT NULL,
  createdAt INTEGER NOT NULL
);
CREATE INDEX moderation_message ON moderation_decisions(messageId, createdAt);
CREATE UNIQUE INDEX discord_message_attribution ON messages(channelId,discordMessageId)
WHERE discordMessageId IS NOT NULL;

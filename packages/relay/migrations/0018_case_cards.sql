/* ---------- Moderation cases' cards in #mod-queue (services/mod-queue.ts) ---------- */

-- One card per case waiting on staff: a message held for review (`held`, by relay message ID), the open reports on one target
-- (`report`, by the case's first report ID) or an appeal (`appeal`, by appeal ID). A row lives only while its card can still
-- change: the case is open, or its last edit Discord refused. Once the card says how the case was decided, the row goes.
CREATE TABLE case_cards (
  kind TEXT NOT NULL CHECK (kind IN ('held', 'report', 'appeal')),
  ref TEXT NOT NULL,
  -- The card's message; NULL until Discord took the post, and again once staff deleted it.
  channel_id TEXT,
  message_id TEXT,
  -- A hash of the layout the message last took, so an unchanged card isn't edited again.
  shows TEXT,
  -- When the card was last brought up to date; the mod-queue job checks the longest-unchecked first.
  checked_at TEXT NOT NULL,
  PRIMARY KEY (kind, ref)
);
CREATE INDEX case_cards_checked ON case_cards(checked_at);

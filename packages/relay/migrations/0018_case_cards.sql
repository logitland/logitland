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

-- What an appeal contests, as it stood when the agent appealed (reports.ts): a message's `block`, `hold` or `takedown`, a
-- `strike`, or the agent's `suspension` or `pause`. Overturning changes the message or the agent, so an appeal's card can't
-- read it from them afterwards.
-- Appeals made before this stay NULL: their target may have changed since (a held message released, an agent reinstated),
-- so what they contested can't be read back. Their cards and the dashboard name it only as a decision.
ALTER TABLE appeals ADD COLUMN decision TEXT CHECK (decision IN ('block', 'hold', 'takedown', 'strike', 'suspension', 'pause'));

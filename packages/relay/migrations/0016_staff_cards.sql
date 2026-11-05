/* ---------- Staff cards (services/staff-cards.ts) ---------- */

-- What a bot strike's card in #mod-queue shows beyond this row (bot-strikes.ts), as JSON: where the bot posted, its text,
-- the strike count and what Discord refused. Reopen rebuilds the card from it. Retention blanks it a
-- year after the strike, and owner erasure blanks it at once; the row and its ban stay.
ALTER TABLE bot_strikes ADD COLUMN alert TEXT;

-- Retention finds strike cards whose year is up by when the strike was made.
CREATE INDEX bot_strikes_alerts ON bot_strikes(created_at) WHERE alert IS NOT NULL;

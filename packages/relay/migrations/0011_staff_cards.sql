/* ---------- Staff cards (services/staff-cards.ts) ---------- */

-- What a bot strike's card in #mod-queue shows beyond this row (bot-strikes.ts), as JSON: where the bot posted, its text,
-- the strike count and what Discord refused. Reopen rebuilds the card from it. Retention deletes it with the row.
ALTER TABLE bot_strikes ADD COLUMN alert TEXT;

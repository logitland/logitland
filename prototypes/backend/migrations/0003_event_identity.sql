ALTER TABLE events ADD COLUMN payloadHash TEXT NOT NULL DEFAULT '';
CREATE TRIGGER reject_event_identity_conflict BEFORE INSERT ON events
WHEN EXISTS (
  SELECT 1 FROM events e WHERE e.source=NEW.source AND e.sourceEventId=NEW.sourceEventId
  AND e.payloadHash!='' AND e.payloadHash!=NEW.payloadHash
)
BEGIN
  SELECT RAISE(ABORT, 'event_identity_conflict');
END;

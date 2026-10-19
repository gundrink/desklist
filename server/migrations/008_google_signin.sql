ALTER TABLE desklist.members ADD COLUMN IF NOT EXISTS google_email text;
CREATE UNIQUE INDEX IF NOT EXISTS members_google_email_uq ON desklist.members (lower(google_email)) WHERE google_email IS NOT NULL;
ALTER TABLE desklist.passkey_flows DROP CONSTRAINT IF EXISTS passkey_flows_kind_check;
ALTER TABLE desklist.passkey_flows ADD CONSTRAINT passkey_flows_kind_check CHECK (kind IN ('register','login','code','google','gcode'));

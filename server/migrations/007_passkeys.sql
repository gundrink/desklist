CREATE TABLE IF NOT EXISTS desklist.member_passkeys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     uuid NOT NULL REFERENCES desklist.members(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key    bytea NOT NULL,
  counter       bigint NOT NULL DEFAULT 0,
  transports    jsonb NOT NULL DEFAULT '[]'::jsonb,
  label         text NOT NULL DEFAULT 'Passkey',
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);
CREATE INDEX IF NOT EXISTS member_passkeys_member_idx ON desklist.member_passkeys(member_id);
CREATE TABLE IF NOT EXISTS desklist.passkey_flows (
  id             text PRIMARY KEY,
  kind           text NOT NULL CHECK (kind IN ('register','login','code')),
  member_id      uuid REFERENCES desklist.members(id) ON DELETE CASCADE,
  challenge      text,
  state          text,
  code_challenge text,
  cb             text,
  used           boolean NOT NULL DEFAULT false,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS desklist.task_setups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid NOT NULL REFERENCES desklist.teams(id) ON DELETE CASCADE,
  title      text NOT NULL,
  title_key  text NOT NULL,
  fields     jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, title_key)
);

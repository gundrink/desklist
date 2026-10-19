-- 0.6.4: username + password accounts, bound to a member slot by redeeming the member's code.
CREATE TABLE IF NOT EXISTS desklist.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  password_hash text NOT NULL,
  member_id uuid UNIQUE REFERENCES desklist.members(id) ON DELETE SET NULL,
  pending_token_hash text,
  pending_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_username_uq ON desklist.accounts (lower(username));
CREATE INDEX IF NOT EXISTS accounts_pending_idx ON desklist.accounts (pending_token_hash) WHERE pending_token_hash IS NOT NULL;

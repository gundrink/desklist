-- 0.6.14 Notebook: private notes per member (owner only). Secret field values are encrypted (AES-GCM, like secret master fields).
CREATE TABLE IF NOT EXISTS desklist.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_member_id uuid NOT NULL REFERENCES desklist.members(id) ON DELETE CASCADE,
  title text NOT NULL,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_owner_idx ON desklist.notes(owner_member_id, updated_at DESC);

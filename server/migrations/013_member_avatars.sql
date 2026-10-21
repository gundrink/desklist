-- 0.6.14 profile photos (small, ~256px square data URLs; kept out of members so auth queries stay light)
CREATE TABLE IF NOT EXISTS desklist.member_avatars (
  member_id uuid PRIMARY KEY REFERENCES desklist.members(id) ON DELETE CASCADE,
  data_url text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

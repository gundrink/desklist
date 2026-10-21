-- 0.6.14: keep 'Checked by' readable after a member is deleted
ALTER TABLE desklist.tasks ADD COLUMN IF NOT EXISTS approved_by_name text NULL;

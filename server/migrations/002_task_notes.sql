-- Per-task notes (the "Notes" column in the checklist table).
ALTER TABLE desklist.tasks ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';

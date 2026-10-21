-- 0.6.15 note status (is the data/API still working)
ALTER TABLE desklist.notes ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'available';

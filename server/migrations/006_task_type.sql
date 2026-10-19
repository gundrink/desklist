ALTER TABLE desklist.tasks ADD COLUMN IF NOT EXISTS task_type text NOT NULL DEFAULT 'standard';
ALTER TABLE desklist.tasks DROP CONSTRAINT IF EXISTS tasks_task_type_check;
ALTER TABLE desklist.tasks ADD CONSTRAINT tasks_task_type_check CHECK (task_type IN ('standard','social'));

-- v6: typed per-task fields, file attachments (bytea, <= ~10 MB), approval note, project deadline.
ALTER TABLE desklist.projects ADD COLUMN IF NOT EXISTS deadline date;
ALTER TABLE desklist.tasks ADD COLUMN IF NOT EXISTS done_note text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS desklist.task_fields (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES desklist.tasks(id) ON DELETE CASCADE,
  section     text NOT NULL DEFAULT 'fields' CHECK (section IN ('fields','reimbursement')),
  label       text NOT NULL,
  type        text NOT NULL CHECK (type IN ('text','email','password','url','number','date','file','dropdown','amount')),
  options     jsonb NOT NULL DEFAULT '{}'::jsonb,
  value       text,            -- password values are AES-256-GCM ciphertext ("v1:...")
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_fields_task_idx ON desklist.task_fields(task_id);

CREATE TABLE IF NOT EXISTS desklist.task_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES desklist.tasks(id) ON DELETE CASCADE,
  field_id    uuid REFERENCES desklist.task_fields(id) ON DELETE CASCADE,
  name        text NOT NULL,
  mime        text NOT NULL DEFAULT 'application/octet-stream',
  size        integer NOT NULL,
  data        bytea NOT NULL,
  uploaded_by uuid REFERENCES desklist.members(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_files_task_idx ON desklist.task_files(task_id);

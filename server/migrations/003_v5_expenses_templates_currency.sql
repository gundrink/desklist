-- v5: per-project / per-task expenses, reimbursements, task templates, per-admin currency.
-- Amounts are stored as numeric together with their currency code.
ALTER TABLE desklist.projects ADD COLUMN IF NOT EXISTS has_expenses boolean NOT NULL DEFAULT false;
ALTER TABLE desklist.projects ADD COLUMN IF NOT EXISTS reimburse_note text NOT NULL DEFAULT '';
ALTER TABLE desklist.projects ADD COLUMN IF NOT EXISTS template_id uuid;

ALTER TABLE desklist.tasks ADD COLUMN IF NOT EXISTS has_expense boolean NOT NULL DEFAULT false;
ALTER TABLE desklist.tasks ADD COLUMN IF NOT EXISTS expense_amount numeric(38,12);
ALTER TABLE desklist.tasks ADD COLUMN IF NOT EXISTS expense_currency text;

ALTER TABLE desklist.teams ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'SOL';
ALTER TABLE desklist.members ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'SOL';

CREATE TABLE IF NOT EXISTS desklist.reimbursements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES desklist.projects(id) ON DELETE CASCADE,
  task_id             uuid UNIQUE REFERENCES desklist.tasks(id) ON DELETE CASCADE,
  item                text NOT NULL,
  category            text NOT NULL DEFAULT 'Other',
  amount              numeric(38,12) NOT NULL CHECK (amount >= 0),
  currency            text NOT NULL DEFAULT 'SOL',
  paid_by_member_id   uuid REFERENCES desklist.members(id) ON DELETE SET NULL,
  spent_on            date,
  note                text NOT NULL DEFAULT '',
  receipt_name        text,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid')),
  reimbursed_at       timestamptz,
  reimbursed_by       uuid REFERENCES desklist.members(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reimbursements_project_idx ON desklist.reimbursements(project_id);

CREATE TABLE IF NOT EXISTS desklist.templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          uuid REFERENCES desklist.teams(id) ON DELETE CASCADE,
  owner_member_id  uuid REFERENCES desklist.members(id) ON DELETE SET NULL,
  name             text NOT NULL,
  description      text NOT NULL DEFAULT '',
  icon             text NOT NULL DEFAULT 'list',
  shared           boolean NOT NULL DEFAULT true,
  tasks            jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS templates_team_idx ON desklist.templates(team_id);

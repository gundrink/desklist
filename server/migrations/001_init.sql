-- Desklist schema. Everything lives in the `desklist` schema.
-- Idempotent: safe to run repeatedly (CREATE ... IF NOT EXISTS).
CREATE SCHEMA IF NOT EXISTS desklist;

CREATE TABLE IF NOT EXISTS desklist.teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS desklist.members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES desklist.teams(id) ON DELETE CASCADE,
  name        text NOT NULL,
  initials    text NOT NULL,
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  code_hash   text,                -- bcrypt hash of the personal sign-in code
  code_bucket text,                -- 2 hex chars of sha256(code): narrows bcrypt comparisons, leaks ~8 bits
  revoked     boolean NOT NULL DEFAULT false,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS members_code_bucket_idx ON desklist.members(code_bucket);

CREATE TABLE IF NOT EXISTS desklist.sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    uuid NOT NULL REFERENCES desklist.members(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,  -- sha256 of the bearer token; raw token never stored
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS desklist.projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES desklist.teams(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#14b8a6',
  is_demo     boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  notes             text NOT NULL DEFAULT '',   -- v1's only free-form project column (autosaved from the UI)
  notes_updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_team_idx ON desklist.projects(team_id);

CREATE TABLE IF NOT EXISTS desklist.tasks (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             uuid NOT NULL REFERENCES desklist.projects(id) ON DELETE CASCADE,
  title                  text NOT NULL,
  done                   boolean NOT NULL DEFAULT false,
  done_at                timestamptz,
  due_date               date,
  bic_member_id          uuid          -- optional; set to the checker when a task is checked
                          REFERENCES desklist.members(id) ON DELETE SET NULL,
  created_by_member_id   uuid REFERENCES desklist.members(id) ON DELETE SET NULL,
  approved_by_member_id  uuid REFERENCES desklist.members(id) ON DELETE SET NULL,
  approved_at            timestamptz,
  sort_order             integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_project_idx ON desklist.tasks(project_id);

-- Master field definitions, managed at runtime from the Manage window.
CREATE TABLE IF NOT EXISTS desklist.field_definitions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  label       text NOT NULL,
  data_type   text NOT NULL CHECK (data_type IN ('text','email','password','select','number','date','url','longtext','currency','person')),
  options     jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_secret   boolean NOT NULL DEFAULT false,
  is_core     boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  archived    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Which master fields a project uses.
CREATE TABLE IF NOT EXISTS desklist.project_fields (
  project_id  uuid NOT NULL REFERENCES desklist.projects(id) ON DELETE CASCADE,
  field_id    uuid NOT NULL REFERENCES desklist.field_definitions(id) ON DELETE CASCADE,
  required    boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, field_id)
);

-- Values of master fields per project. Secret fields store AES-256-GCM ciphertext ("v1:...").
CREATE TABLE IF NOT EXISTS desklist.project_field_values (
  project_id  uuid NOT NULL REFERENCES desklist.projects(id) ON DELETE CASCADE,
  field_id    uuid NOT NULL REFERENCES desklist.field_definitions(id) ON DELETE CASCADE,
  value       text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, field_id)
);

-- Free-form per-project columns (not master fields).
CREATE TABLE IF NOT EXISTS desklist.project_custom_columns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES desklist.projects(id) ON DELETE CASCADE,
  label       text NOT NULL,
  data_type   text NOT NULL CHECK (data_type IN ('text','url','date','number','longtext','currency')),
  value       text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS custom_cols_project_idx ON desklist.project_custom_columns(project_id);

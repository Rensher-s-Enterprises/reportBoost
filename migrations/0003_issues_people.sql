alter table dsr_reports add column if not exists crew_today jsonb not null default '[]';

create table if not exists dsr_people (
  id text primary key,
  user_id text not null,
  project_id text not null references dsr_projects(id) on delete cascade,
  name text not null,
  initials text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists dsr_people_project_idx on dsr_people (project_id, user_id);

create table if not exists dsr_issues (
  id text primary key,
  user_id text not null,
  project_id text not null references dsr_projects(id) on delete cascade,
  code text not null,
  title text not null default '',
  description text not null default '',
  status text not null default 'open',
  closed_by text not null default '',
  closed_at_time text not null default '',
  minutes_spent integer not null default 0,
  notes text not null default '',
  last_import_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists dsr_issues_code_idx on dsr_issues (user_id, project_id, code);
create index if not exists dsr_issues_project_idx on dsr_issues (project_id);

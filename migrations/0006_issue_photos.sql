create table if not exists dsr_issue_photos (
  id text primary key,
  user_id text not null,
  project_id text not null references dsr_projects(id) on delete cascade,
  issue_code text not null,
  kind text not null default 'problem',
  mime text not null default 'image/jpeg',
  data_b64 text not null,
  caption text not null default '',
  source_report_id text,
  created_at timestamptz not null default now()
);
create index if not exists dsr_issue_photos_code_idx
  on dsr_issue_photos (user_id, project_id, issue_code, kind);

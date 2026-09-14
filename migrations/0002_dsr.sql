-- Daily Service Report field app
create table if not exists dsr_projects (
  id text primary key,
  user_id text not null,
  name text not null,
  customer text not null default '',
  wo text not null default '',
  location text not null default '',
  po text not null default '',
  charge_code text not null default '',
  transportation text not null default 'Rental Car / Flight / Service Truck',
  generator_size text not null default 'N/A',
  qty text not null default 'N/A',
  operating_voltage text not null default '',
  dc_voltage text not null default '',
  switchgear_mfr text not null default '',
  prints text not null default '',
  job_task text not null default '',
  technician text not null default '',
  initials text not null default 'XXX',
  default_time_on text not null default '0700',
  default_time_off text not null default '2000',
  crew text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dsr_projects_user_idx on dsr_projects (user_id);

create table if not exists dsr_reports (
  id text primary key,
  user_id text not null,
  project_id text not null references dsr_projects(id) on delete cascade,
  work_date date not null,
  report_no text not null default '',
  time_on text not null default '0700',
  time_off text not null default '2000',
  mileage text not null default 'N/A',
  estimated_cost text not null default 'N/A',
  material_used text not null default 'N/A',
  parts_needed_text text not null default 'See parts list.',
  job_complete boolean not null default false,
  parts_needed boolean not null default true,
  drawings_needed boolean not null default false,
  return_call_needed boolean not null default false,
  rental_needed boolean not null default false,
  comments text not null default '',
  customer_sign_name text not null default '',
  entries jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists dsr_reports_one_per_day
  on dsr_reports (user_id, project_id, work_date);
create index if not exists dsr_reports_project_idx on dsr_reports (project_id);

create table if not exists dsr_photos (
  id text primary key,
  user_id text not null,
  report_id text not null references dsr_reports(id) on delete cascade,
  caption text not null default '',
  cxalloy text not null default '',
  mime text not null default 'image/jpeg',
  data_b64 text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists dsr_photos_report_idx on dsr_photos (report_id);

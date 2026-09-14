create table if not exists dsr_profiles (
  user_id text primary key,
  full_name text not null default '',
  initials text not null default '',
  employee_number text not null default '',
  phone text not null default '',
  email text not null default '',
  default_time_on text not null default '0700',
  default_time_off text not null default '2000',
  updated_at timestamptz not null default now()
);

create table if not exists dsr_roster (
  id text primary key,
  user_id text not null,
  name text not null,
  initials text not null default '',
  employee_number text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists dsr_roster_user_name_idx on dsr_roster (user_id, lower(name));
create index if not exists dsr_roster_user_idx on dsr_roster (user_id);

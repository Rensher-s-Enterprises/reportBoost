alter table dsr_issues add column if not exists disposition text not null default 'ours';
alter table dsr_issues add column if not exists disposition_note text not null default '';

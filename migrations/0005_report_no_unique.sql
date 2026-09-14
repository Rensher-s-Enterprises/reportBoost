drop index if exists dsr_reports_one_per_day;
create unique index if not exists dsr_reports_one_per_no
  on dsr_reports (user_id, project_id, report_no)
  where report_no <> '';
create index if not exists dsr_reports_day_idx
  on dsr_reports (user_id, project_id, work_date);

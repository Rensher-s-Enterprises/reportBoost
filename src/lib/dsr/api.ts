import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql, type Sql } from "@/lib/db";
import { initialsFromName, makeReportNo, namesFromCrew } from "@/lib/utils";
import type {
  CxalloyExportPhoto,
  CxalloyExportPunch,
  Issue,
  IssueDisposition,
  IssuePhoto,
  IssueStatus,
  Person,
  Photo,
  PhotoMeta,
  Project,
  Report,
  ReportSummary,
  RosterPerson,
  TechProfile,
  TimelineEntry,
} from "./types";
import { emptyProfile } from "./types";
import { refineCxalloyImport } from "./ai";
import {
  entryClosedCodes,
  entryIssueCodes,
  issueEvidenceCaption,
  mergeCxalloySeeds,
  normalizeIssueCode,
  parseCxalloyDocument,
  stampIssueCodes,
  type IssueSeed,
} from "./cxalloy";
import { MUSTANG_ISSUES } from "./cxalloy-catalog";
import {
  cleanField,
  cleanReportNo,
  dateFromFilename,
  extractCxalloyIssuePhotos,
  extractDsrPhotos,
  looksLikeCxalloyList,
  looksLikeFormChrome,
  parseDsrText,
  validWorkOrder,
} from "./parse-dsr";
import { emptyPunch, entryMarksIssueClosed } from "./timeline";

function nid() {
  return crypto.randomUUID();
}

function asBool(v: unknown) {
  return v === true || v === "t" || v === "true" || v === 1 || v === "1";
}

function parseStringList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x)).filter(Boolean);
  if (typeof raw === "string") {
    try {
      return parseStringList(JSON.parse(raw));
    } catch {
      return namesFromCrew(raw);
    }
  }
  return [];
}

function parseEntries(raw: unknown): TimelineEntry[] {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) arr = p;
    } catch {
      return [];
    }
  }
  return arr.map((item) => {
    const e = item as Partial<TimelineEntry> & { time?: string; text?: string };
    const kind = e.kind === "standby" ? "standby" : "work";
    const where = e.standbyWhere === "hotel" || e.standbyWhere === "site" ? e.standbyWhere : "";
    const stamped = stampIssueCodes([
      (e as { cxalloys?: unknown }).cxalloys,
      e.cxalloy,
    ]);
    const closedFlag = Boolean((e as { closed?: unknown }).closed);
    const closedCodes = entryClosedCodes({
      ...stamped,
      closed: closedFlag,
      closedCodes: (e as { closedCodes?: unknown }).closedCodes as string[] | undefined,
    });
    return {
      id: String(e.id || nid()),
      time: String(e.time ?? ""),
      endTime: String(e.endTime ?? ""),
      text: cleanField(String(e.text ?? ""), 600),
      ...stamped,
      workers: parseStringList(e.workers),
      kind,
      standbyWhere: where,
      standbyReason: String(e.standbyReason ?? ""),
      standbyNote: String(e.standbyNote ?? ""),
      closed: closedCodes.length > 0,
      closedCodes,
    };
  });
}

type ProjectRow = {
  id: string;
  name: string;
  customer: string;
  wo: string;
  location: string;
  po: string;
  charge_code: string;
  transportation: string;
  generator_size: string;
  qty: string;
  operating_voltage: string;
  dc_voltage: string;
  switchgear_mfr: string;
  prints: string;
  job_task: string;
  technician: string;
  initials: string;
  default_time_on: string;
  default_time_off: string;
  crew: string;
  created_at: string;
  updated_at: string;
  report_count?: number | string;
  last_work_date?: string | null;
};

function mapProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    customer: r.customer,
    wo: r.wo,
    location: r.location,
    po: r.po,
    chargeCode: r.charge_code,
    transportation: r.transportation,
    generatorSize: r.generator_size,
    qty: r.qty,
    operatingVoltage: r.operating_voltage,
    dcVoltage: r.dc_voltage,
    switchgearMfr: r.switchgear_mfr,
    prints: r.prints,
    jobTask: r.job_task,
    technician: r.technician,
    initials: r.initials,
    defaultTimeOn: r.default_time_on,
    defaultTimeOff: r.default_time_off,
    crew: r.crew,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    reportCount: Number(r.report_count || 0),
    lastWorkDate: String(r.last_work_date || "").slice(0, 10),
  };
}

type ReportRow = {
  id: string;
  project_id: string;
  work_date: string;
  report_no: string;
  time_on: string;
  time_off: string;
  mileage: string;
  estimated_cost: string;
  material_used: string;
  parts_needed_text: string;
  job_complete: unknown;
  parts_needed: unknown;
  drawings_needed: unknown;
  return_call_needed: unknown;
  rental_needed: unknown;
  comments: string;
  customer_sign_name: string;
  entries: unknown;
  crew_today: unknown;
};

function mapReport(r: ReportRow): Report {
  return {
    id: r.id,
    projectId: r.project_id,
    workDate: String(r.work_date).slice(0, 10),
    reportNo: cleanReportNo(r.report_no) || String(r.report_no || "").slice(0, 16),
    timeOn: r.time_on,
    timeOff: r.time_off,
    mileage: r.mileage,
    estimatedCost: r.estimated_cost,
    materialUsed: cleanField(r.material_used, 200),
    partsNeededText: cleanField(r.parts_needed_text, 200),
    jobComplete: asBool(r.job_complete),
    partsNeeded: asBool(r.parts_needed),
    drawingsNeeded: asBool(r.drawings_needed),
    returnCallNeeded: asBool(r.return_call_needed),
    rentalNeeded: asBool(r.rental_needed),
    comments: cleanField(r.comments, 500),
    customerSignName: r.customer_sign_name,
    entries: parseEntries(r.entries),
    crewToday: parseStringList(r.crew_today),
  };
}

export const getProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensureProfileTables(sql);
    const rows = await sql<{
      full_name: string;
      initials: string;
      employee_number: string;
      phone: string;
      email: string;
      default_time_on: string;
      default_time_off: string;
    }>`
      select full_name, initials, employee_number, phone, email, default_time_on, default_time_off
      from dsr_profiles where user_id = ${context.userId}
    `;
    if (!rows[0]) return emptyProfile();
    return {
      fullName: rows[0].full_name,
      initials: rows[0].initials,
      employeeNumber: rows[0].employee_number,
      phone: rows[0].phone,
      email: rows[0].email,
      defaultTimeOn: rows[0].default_time_on || "0700",
      defaultTimeOff: rows[0].default_time_off || "2000",
    } satisfies TechProfile;
  });

export const saveProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((p: TechProfile) => p)
  .handler(async ({ context, data: p }) => {
    const sql = await getSql();
    await ensureProfileTables(sql);
    const initials = (p.initials || initialsFromName(p.fullName) || "XXX").toUpperCase().slice(0, 8);
    await sql`
      insert into dsr_profiles (
        user_id, full_name, initials, employee_number, phone, email,
        default_time_on, default_time_off, updated_at
      ) values (
        ${context.userId}, ${p.fullName.trim()}, ${initials}, ${p.employeeNumber.trim()},
        ${p.phone.trim()}, ${p.email.trim()}, ${p.defaultTimeOn || "0700"},
        ${p.defaultTimeOff || "2000"}, now()
      )
      on conflict (user_id) do update set
        full_name = excluded.full_name,
        initials = excluded.initials,
        employee_number = excluded.employee_number,
        phone = excluded.phone,
        email = excluded.email,
        default_time_on = excluded.default_time_on,
        default_time_off = excluded.default_time_off,
        updated_at = now()
    `;
    return { ...p, initials };
  });

export const listRoster = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await ensureProfileTables(sql);
    const rows = await sql<{
      id: string;
      name: string;
      initials: string;
      employee_number: string;
      active: unknown;
    }>`
      select id, name, initials, employee_number, active
      from dsr_roster
      where user_id = ${context.userId} and active = true
      order by name
    `;
    return rows.map(
      (r): RosterPerson => ({
        id: r.id,
        name: r.name,
        initials: r.initials || initialsFromName(r.name),
        employeeNumber: r.employee_number || "",
        active: asBool(r.active),
      }),
    );
  });

export const saveRosterPerson = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id?: string; name: string; employeeNumber?: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensureProfileTables(sql);
    const name = data.name.trim();
    if (!name) throw new Error("Name required");
    const existing = await sql<{ id: string }>`
      select id from dsr_roster
      where user_id = ${context.userId} and lower(name) = ${name.toLowerCase()}
      limit 1
    `;
    const id = data.id || existing[0]?.id || nid();
    const initials = initialsFromName(name);
    await sql`
      insert into dsr_roster (id, user_id, name, initials, employee_number, active)
      values (${id}, ${context.userId}, ${name}, ${initials}, ${data.employeeNumber || ""}, true)
      on conflict (id) do update set
        name = excluded.name,
        initials = excluded.initials,
        employee_number = excluded.employee_number,
        active = true
    `;
    return id;
  });

export const deleteRosterPerson = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    await sql`
      update dsr_roster set active = false
      where id = ${id} and user_id = ${context.userId}
    `;
  });

export const listProjects = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<ProjectRow>`
      select p.*,
        (select count(*) from dsr_reports r where r.project_id = p.id and r.user_id = p.user_id) as report_count,
        (select max(work_date)::text from dsr_reports r where r.project_id = p.id and r.user_id = p.user_id) as last_work_date
      from dsr_projects p
      where p.user_id = ${context.userId}
      order by p.updated_at desc
    `;
    return rows.map(mapProject);
  });

export const getProject = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const rows = await sql<ProjectRow>`
      select * from dsr_projects where id = ${id} and user_id = ${context.userId}
    `;
    return rows[0] ? mapProject(rows[0]) : null;
  });

export const saveProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((p: Project) => p)
  .handler(async ({ context, data: p }) => {
    const sql = await getSql();
    const id = p.id || nid();
    await sql`
      insert into dsr_projects (
        id, user_id, name, customer, wo, location, po, charge_code, transportation,
        generator_size, qty, operating_voltage, dc_voltage, switchgear_mfr, prints,
        job_task, technician, initials, default_time_on, default_time_off, crew, updated_at
      ) values (
        ${id}, ${context.userId}, ${p.name}, ${p.customer}, ${p.wo}, ${p.location},
        ${p.po}, ${p.chargeCode}, ${p.transportation}, ${p.generatorSize}, ${p.qty},
        ${p.operatingVoltage}, ${p.dcVoltage}, ${p.switchgearMfr}, ${p.prints},
        ${p.jobTask}, ${p.technician}, ${p.initials}, ${p.defaultTimeOn},
        ${p.defaultTimeOff}, ${p.crew}, now()
      )
      on conflict (id) do update set
        name = excluded.name,
        customer = excluded.customer,
        wo = excluded.wo,
        location = excluded.location,
        po = excluded.po,
        charge_code = excluded.charge_code,
        transportation = excluded.transportation,
        generator_size = excluded.generator_size,
        qty = excluded.qty,
        operating_voltage = excluded.operating_voltage,
        dc_voltage = excluded.dc_voltage,
        switchgear_mfr = excluded.switchgear_mfr,
        prints = excluded.prints,
        job_task = excluded.job_task,
        technician = excluded.technician,
        initials = excluded.initials,
        default_time_on = excluded.default_time_on,
        default_time_off = excluded.default_time_off,
        crew = excluded.crew,
        updated_at = now()
      where dsr_projects.user_id = ${context.userId}
    `;
    const names = namesFromCrew(p.crew);
    if (p.technician && !names.some((n) => n.toLowerCase() === p.technician.toLowerCase())) {
      names.unshift(p.technician);
    }
    for (const name of names) {
      const existing = await sql<{ id: string }>`
        select id from dsr_people
        where user_id = ${context.userId} and project_id = ${id} and lower(name) = ${name.toLowerCase()}
      `;
      if (existing[0]) continue;
      await sql`
        insert into dsr_people (id, user_id, project_id, name, initials, active)
        values (${nid()}, ${context.userId}, ${id}, ${name}, ${initialsFromName(name)}, true)
      `;
    }
    return id;
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    await sql`delete from dsr_projects where id = ${id} and user_id = ${context.userId}`;
  });

export const deleteReport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    await sql`delete from dsr_reports where id = ${id} and user_id = ${context.userId}`;
  });

export const listReports = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((projectId: string) => projectId)
  .handler(async ({ context, data: projectId }) => {
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      project_id: string;
      work_date: string;
      report_no: string;
      entries: unknown;
      photo_count: number;
    }>`
      select r.id, r.project_id, r.work_date, r.report_no, r.entries,
        (select count(*) from dsr_photos p where p.report_id = r.id)::int as photo_count
      from dsr_reports r
      where r.user_id = ${context.userId} and r.project_id = ${projectId}
      order by r.work_date desc
    `;
    return rows.map(
      (r): ReportSummary => ({
        id: r.id,
        projectId: r.project_id,
        workDate: String(r.work_date).slice(0, 10),
        reportNo: cleanReportNo(r.report_no) || String(r.report_no || "").slice(0, 16),
        entryCount: parseEntries(r.entries).filter((e) => e.time || e.text).length,
        photoCount: Number(r.photo_count || 0),
      }),
    );
  });

export const listReportsInRange = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { projectId: string; from: string; to: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql<{ id: string }>`
      select id from dsr_reports
      where user_id = ${context.userId}
        and project_id = ${data.projectId}
        and work_date >= ${data.from}
        and work_date <= ${data.to}
      order by work_date
    `;
    return rows.map((r) => r.id);
  });

export const getReport = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const rows = await sql<ReportRow>`
      select * from dsr_reports where id = ${id} and user_id = ${context.userId}
    `;
    return rows[0] ? mapReport(rows[0]) : null;
  });

export const openDayReport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { projectId: string; workDate: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const existing = await sql<ReportRow>`
      select * from dsr_reports
      where user_id = ${context.userId}
        and project_id = ${data.projectId}
        and work_date = ${data.workDate}
      order by updated_at desc
      limit 1
    `;
    if (existing[0]) return mapReport(existing[0]);

    const proj = await sql<{
      initials: string;
      default_time_on: string;
      default_time_off: string;
      crew: string;
      technician: string;
    }>`
      select initials, default_time_on, default_time_off, crew, technician
      from dsr_projects where id = ${data.projectId} and user_id = ${context.userId}
    `;
    if (!proj[0]) throw new Error("Project not found");
    await ensureProfileTables(sql);
    const profile = await sql<{
      initials: string;
      full_name: string;
      default_time_on: string;
      default_time_off: string;
    }>`
      select initials, full_name, default_time_on, default_time_off
      from dsr_profiles where user_id = ${context.userId}
    `;
    const initials = profile[0]?.initials || proj[0].initials;
    const timeOn = profile[0]?.default_time_on || proj[0].default_time_on;
    const timeOff = profile[0]?.default_time_off || proj[0].default_time_off;
    const tech = profile[0]?.full_name || proj[0].technician;
    const id = nid();
    const reportNo = makeReportNo(data.workDate, initials);
    const crew = [
      ...new Set(
        [tech, ...namesFromCrew(proj[0].crew)].map((n) => n.trim()).filter(Boolean),
      ),
    ];
    const comments = crew.length ? `Work day. Crew on site: ${crew.join(", ")}.` : "Work day.";
    await sql`
      insert into dsr_reports (
        id, user_id, project_id, work_date, report_no, time_on, time_off, comments, crew_today
      ) values (
        ${id}, ${context.userId}, ${data.projectId}, ${data.workDate},
        ${reportNo}, ${timeOn}, ${timeOff}, ${comments},
        ${JSON.stringify(crew)}::jsonb
      )
    `;
    const rows = await sql<ReportRow>`
      select * from dsr_reports where id = ${id} and user_id = ${context.userId}
    `;
    return mapReport(rows[0]);
  });

export const saveReport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((r: Report) => r)
  .handler(async ({ context, data: r }) => {
    const sql = await getSql();
    const clash = await sql<{ id: string }>`
      select id from dsr_reports
      where user_id = ${context.userId}
        and project_id = ${r.projectId}
        and work_date = ${r.workDate}
        and id <> ${r.id}
      limit 1
    `;
    if (clash[0]) {
      throw new Error("There's already a report for that date. Open that day instead of changing this one's date.");
    }
    const entries = JSON.stringify(r.entries ?? []);
    const crewToday = JSON.stringify(r.crewToday ?? []);
    try {
      await sql`
        update dsr_reports set
          work_date = ${r.workDate},
          report_no = ${r.reportNo},
          time_on = ${r.timeOn},
          time_off = ${r.timeOff},
          mileage = ${r.mileage},
          estimated_cost = ${r.estimatedCost},
          material_used = ${r.materialUsed},
          parts_needed_text = ${r.partsNeededText},
          job_complete = ${r.jobComplete},
          parts_needed = ${r.partsNeeded},
          drawings_needed = ${r.drawingsNeeded},
          return_call_needed = ${r.returnCallNeeded},
          rental_needed = ${r.rentalNeeded},
          comments = ${r.comments},
          customer_sign_name = ${r.customerSignName},
          entries = ${entries}::jsonb,
          crew_today = ${crewToday}::jsonb,
          updated_at = now()
        where id = ${r.id} and user_id = ${context.userId}
      `;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/unique|duplicate/i.test(msg)) {
        throw new Error("That report number is already used on this job. Change the number or pick another date.");
      }
      throw e;
    }
    await sql`
      update dsr_projects set updated_at = now()
      where id = ${r.projectId} and user_id = ${context.userId}
    `;
  });

export const listPhotos = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((reportId: string) => reportId)
  .handler(async ({ context, data: reportId }) => {
    const sql = await getSql();
    const rows = await sql<PhotoMeta & { sort_order: number }>`
      select id, caption, cxalloy, mime, sort_order
      from dsr_photos
      where report_id = ${reportId} and user_id = ${context.userId}
      order by sort_order, created_at
    `;
    return rows.map(
      (r): PhotoMeta => ({
        id: r.id,
        caption: r.caption,
        cxalloy: r.cxalloy,
        mime: r.mime,
        sortOrder: Number(r.sort_order),
      }),
    );
  });

export const getPhoto = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const rows = await sql<Photo>`
      select id, caption, cxalloy, mime, sort_order as "sortOrder", data_b64 as "dataB64"
      from dsr_photos where id = ${id} and user_id = ${context.userId}
    `;
    return rows[0] ?? null;
  });

export const addPhoto = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      reportId: string;
      dataB64: string;
      mime?: string;
      caption?: string;
      cxalloy?: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    if (!data.dataB64 || data.dataB64.length > 2_500_000) {
      throw new Error("Photo is too large. Use a smaller picture.");
    }
    const sql = await getSql();
    const owned = await sql<{ id: string }>`
      select id from dsr_reports where id = ${data.reportId} and user_id = ${context.userId}
    `;
    if (!owned[0]) throw new Error("Report not found");
    const id = nid();
    const max = await sql<{ m: number }>`
      select coalesce(max(sort_order), -1)::int as m from dsr_photos
      where report_id = ${data.reportId}
    `;
    const cxalloy = data.cxalloy ? normalizeIssueCode(data.cxalloy) : "";
    await sql`
      insert into dsr_photos (id, user_id, report_id, mime, data_b64, sort_order, caption, cxalloy)
      values (
        ${id}, ${context.userId}, ${data.reportId},
        ${data.mime || "image/jpeg"}, ${data.dataB64}, ${(max[0]?.m ?? -1) + 1},
        ${cleanField(data.caption || "", 420)}, ${cxalloy}
      )
    `;
    if (!cxalloy) await autoTagReportPhotos(sql, context.userId, data.reportId);
    return id;
  });

export const updatePhotoMeta = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; caption: string; cxalloy: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      update dsr_photos set caption = ${data.caption}, cxalloy = ${data.cxalloy}
      where id = ${data.id} and user_id = ${context.userId}
    `;
  });

export const deletePhoto = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    await sql`delete from dsr_photos where id = ${id} and user_id = ${context.userId}`;
  });

export const listPhotosFull = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((reportId: string) => reportId)
  .handler(async ({ context, data: reportId }) => {
    const sql = await getSql();
    const rows = await sql<Photo>`
      select id, caption, cxalloy, mime, sort_order as "sortOrder", data_b64 as "dataB64"
      from dsr_photos
      where report_id = ${reportId} and user_id = ${context.userId}
      order by sort_order, created_at
    `;
    return rows;
  });

export const getExportBundle = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((reportId: string) => reportId)
  .handler(async ({ context, data: reportId }) => {
    const sql = await getSql();
    const reports = await sql<ReportRow>`
      select * from dsr_reports where id = ${reportId} and user_id = ${context.userId}
    `;
    if (!reports[0]) return null;
    const report = mapReport(reports[0]);
    const projects = await sql<ProjectRow>`
      select * from dsr_projects where id = ${report.projectId} and user_id = ${context.userId}
    `;
    if (!projects[0]) return null;
    const photos = await sql<Photo>`
      select id, caption, cxalloy, mime, sort_order as "sortOrder", data_b64 as "dataB64"
      from dsr_photos
      where report_id = ${reportId} and user_id = ${context.userId}
      order by sort_order, created_at
    `;
    const codes = [...new Set(report.entries.flatMap((e) => entryIssueCodes(e)))];
    const inList = codes.map((_, i) => `$${i + 4}`).join(", ");
    const issuePhotos = await sql.query<{
      id: string;
      issue_code: string;
      mime: string;
      data_b64: string;
      caption: string;
    }>(
      `select id, issue_code, mime, data_b64, caption
       from dsr_issue_photos
       where user_id = $1
         and project_id = $2
         and kind = 'evidence'
         and (
           source_report_id = $3
           ${codes.length ? `or issue_code in (${inList})` : ""}
         )
       order by created_at`,
      [context.userId, report.projectId, reportId, ...codes],
    );
    const seen = new Set(photos.map((p) => p.dataB64.slice(0, 80)));
    const extra: Photo[] = [];
    let sort = photos.length;
    for (const p of issuePhotos) {
      const key = p.data_b64.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      extra.push({
        id: p.id,
        caption: p.caption,
        cxalloy: p.issue_code,
        mime: p.mime,
        sortOrder: sort,
        dataB64: p.data_b64,
      });
      sort += 1;
    }
    await ensureProfileTables(sql);
    const profileRows = await sql<{
      full_name: string;
      initials: string;
      employee_number: string;
      phone: string;
      email: string;
      default_time_on: string;
      default_time_off: string;
    }>`
      select full_name, initials, employee_number, phone, email, default_time_on, default_time_off
      from dsr_profiles where user_id = ${context.userId}
    `;
    const profile: TechProfile = profileRows[0]
      ? {
          fullName: profileRows[0].full_name,
          initials: profileRows[0].initials,
          employeeNumber: profileRows[0].employee_number,
          phone: profileRows[0].phone,
          email: profileRows[0].email,
          defaultTimeOn: profileRows[0].default_time_on,
          defaultTimeOff: profileRows[0].default_time_off,
        }
      : emptyProfile();
    return { project: mapProject(projects[0]), report, photos: [...photos, ...extra], profile };
  });

type PersonRow = {
  id: string;
  project_id: string;
  name: string;
  initials: string;
  active: unknown;
};

function mapPerson(r: PersonRow): Person {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    initials: r.initials || initialsFromName(r.name),
    active: asBool(r.active),
  };
}

export const listPeople = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((projectId: string) => projectId)
  .handler(async ({ context, data: projectId }) => {
    const sql = await getSql();
    const rows = await sql<PersonRow>`
      select id, project_id, name, initials, active from dsr_people
      where user_id = ${context.userId} and project_id = ${projectId}
      order by name
    `;
    return rows.map(mapPerson);
  });

export const savePerson = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { projectId: string; id?: string; name: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const owned = await sql<{ id: string }>`
      select id from dsr_projects where id = ${data.projectId} and user_id = ${context.userId}
    `;
    if (!owned[0]) throw new Error("Project not found");
    const name = data.name.trim();
    if (!name) throw new Error("Name required");
    const id = data.id || nid();
    await sql`
      insert into dsr_people (id, user_id, project_id, name, initials, active)
      values (${id}, ${context.userId}, ${data.projectId}, ${name}, ${initialsFromName(name)}, true)
      on conflict (id) do update set
        name = excluded.name,
        initials = excluded.initials,
        active = true
      where dsr_people.user_id = ${context.userId}
    `;
    await ensureProfileTables(sql);
    const rosterHit = await sql<{ id: string }>`
      select id from dsr_roster
      where user_id = ${context.userId} and lower(name) = ${name.toLowerCase()}
      limit 1
    `;
    const rid = rosterHit[0]?.id || nid();
    await sql`
      insert into dsr_roster (id, user_id, name, initials, employee_number, active)
      values (${rid}, ${context.userId}, ${name}, ${initialsFromName(name)}, '', true)
      on conflict (id) do update set name = excluded.name, initials = excluded.initials, active = true
    `;
    return id;
  });

export const removePerson = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    await sql`delete from dsr_people where id = ${id} and user_id = ${context.userId}`;
  });

type IssueRow = {
  id: string;
  project_id: string;
  code: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  priority_label: string;
  assigned_to: string;
  asset: string;
  discipline: string;
  issue_type: string;
  due_date: string;
  created_by: string;
  identified_on: string;
  closed_by: string;
  closed_at_time: string;
  minutes_spent: number;
  notes: string;
  last_import_at: string | null;
  photo_count?: number;
  disposition?: string;
  disposition_note?: string;
};

function asIssueStatusRow(raw: unknown): IssueStatus {
  const t = String(raw || "").trim().toLowerCase();
  if (t === "fixed" || t.includes("closed") || t.includes("complete")) return "fixed";
  if (t === "in_progress" || t.includes("progress")) return "in_progress";
  return "open";
}

function mapIssue(r: IssueRow): Issue {
  const status = asIssueStatusRow(r.status);
  return {
    id: r.id,
    projectId: r.project_id,
    code: r.code,
    title: r.title,
    description: r.description,
    status,
    priority: r.priority || "",
    priorityLabel: r.priority_label || "",
    assignedTo: r.assigned_to || "",
    asset: r.asset || "",
    discipline: r.discipline || "",
    type: r.issue_type || "",
    dueDate: r.due_date || "",
    createdBy: r.created_by || "",
    identifiedOn: r.identified_on || "",
    closedBy: r.closed_by,
    closedAtTime: r.closed_at_time,
    minutesSpent: Number(r.minutes_spent || 0),
    notes: r.notes,
    lastImportAt: r.last_import_at ? String(r.last_import_at) : null,
    photoCount: Number(r.photo_count || 0),
    disposition: asDisposition(r.disposition),
    dispositionNote: r.disposition_note || "",
  };
}

async function ensureIssueExtraColumns(sql: Sql) {
  try {
    await sql.query(
      "alter table dsr_issues add column if not exists disposition text not null default 'ours'",
    );
    await sql.query(
      "alter table dsr_issues add column if not exists disposition_note text not null default ''",
    );
  } catch {
    /* column already there, or a concurrent migrate */
  }
}

async function ensureProfileTables(sql: Sql) {
  try {
    await sql.query(`
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
      )
    `);
    await sql.query(`
      create table if not exists dsr_roster (
        id text primary key,
        user_id text not null,
        name text not null,
        initials text not null default '',
        employee_number text not null default '',
        active boolean not null default true,
        created_at timestamptz not null default now()
      )
    `);
  } catch {
    /* already created */
  }
}

function asDisposition(raw: unknown): IssueDisposition {
  const t = String(raw || "");
  if (t === "reassigned" || t === "disputed" || t === "as_designed" || t === "needs_engineering") {
    return t;
  }
  return "ours";
}

export const listIssues = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: string | { projectId: string }) =>
    typeof d === "string" ? { projectId: d } : d,
  )
  .handler(async ({ context, data }) => {
    const projectId = data.projectId;
    const sql = await getSql();
    await ensureIssueExtraColumns(sql);
    const rows = await sql<IssueRow>`
      select i.*, coalesce((
        select count(*)::int from dsr_issue_photos p
        where p.user_id = i.user_id and p.project_id = i.project_id and p.issue_code = i.code
      ), 0) as photo_count
      from dsr_issues i
      where i.user_id = ${context.userId} and i.project_id = ${projectId}
      order by
        case i.status when 'open' then 0 when 'in_progress' then 1 else 2 end,
        case i.priority when 'P1' then 0 when 'P2' then 1 when 'P3' then 2 else 3 end,
        i.code
    `;
    return rows.map(mapIssue);
  });

export const getCxalloyExportBundle = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((projectId: string) => projectId)
  .handler(async ({ context, data: projectId }) => {
    const sql = await getSql();
    const projects = await sql<ProjectRow>`
      select * from dsr_projects where id = ${projectId} and user_id = ${context.userId}
    `;
    if (!projects[0]) throw new Error("Project not found");
    const issueRows = await sql<IssueRow>`
      select i.*, coalesce((
        select count(*)::int from dsr_issue_photos p
        where p.user_id = i.user_id and p.project_id = i.project_id and p.issue_code = i.code
      ), 0) as photo_count
      from dsr_issues i
      where i.user_id = ${context.userId} and i.project_id = ${projectId}
      order by
        case i.status when 'open' then 0 when 'in_progress' then 1 else 2 end,
        case i.priority when 'P1' then 0 when 'P2' then 1 when 'P3' then 2 else 3 end,
        i.code
    `;
    const issues = issueRows.map(mapIssue);
    const problem = await sql<{
      issue_code: string;
      kind: string;
      mime: string;
      data_b64: string;
      caption: string;
    }>`
      select issue_code, kind, mime, data_b64, caption
      from dsr_issue_photos
      where user_id = ${context.userId} and project_id = ${projectId}
      order by created_at
    `;
    const evidenceFromReports = await sql<{
      issue_code: string;
      mime: string;
      data_b64: string;
      caption: string;
      work_date: string;
    }>`
      select p.cxalloy as issue_code, p.mime, p.data_b64, p.caption, r.work_date::text as work_date
      from dsr_photos p
      join dsr_reports r on r.id = p.report_id
      where p.user_id = ${context.userId} and r.project_id = ${projectId}
        and p.cxalloy <> ''
      order by r.work_date, p.sort_order
    `;
    const photos: CxalloyExportPhoto[] = [];
    const seen = new Set<string>();
    const push = (ph: CxalloyExportPhoto) => {
      const key = `${ph.code}:${ph.dataB64.slice(0, 80)}`;
      if (seen.has(key) || !ph.dataB64) return;
      seen.add(key);
      photos.push(ph);
    };
    for (const p of problem) {
      push({
        code: p.issue_code,
        kind: p.kind === "evidence" ? "evidence" : "problem",
        mime: p.mime,
        dataB64: p.data_b64,
        caption: p.caption,
        workDate: "",
      });
    }
    for (const p of evidenceFromReports) {
      push({
        code: p.issue_code,
        kind: "evidence",
        mime: p.mime,
        dataB64: p.data_b64,
        caption: p.caption,
        workDate: String(p.work_date || "").slice(0, 10),
      });
    }
    const reportRows = await sql<{ work_date: string; entries: unknown }>`
      select work_date::text as work_date, entries
      from dsr_reports
      where user_id = ${context.userId} and project_id = ${projectId}
      order by work_date
    `;
    const punches: CxalloyExportPunch[] = [];
    for (const row of reportRows) {
      const entries = parseEntries(row.entries);
      for (const e of entries) {
        const closed = entryClosedCodes(e);
        for (const code of entryIssueCodes(e)) {
          punches.push({
            code,
            workDate: String(row.work_date || "").slice(0, 10),
            text: String(e.text || "").trim(),
            closed: closed.includes(code),
            workers: Array.isArray(e.workers) ? e.workers.map(String) : [],
          });
        }
      }
    }
    return { project: mapProject(projects[0]), issues, photos, punches };
  });

export const saveIssue = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: Partial<Issue> & { projectId: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const owned = await sql<{ id: string }>`
      select id from dsr_projects where id = ${data.projectId} and user_id = ${context.userId}
    `;
    if (!owned[0]) throw new Error("Project not found");
    const id = data.id || nid();
    const code = String(data.code || "").trim();
    if (!code) throw new Error("Issue code required");
    await sql`
      insert into dsr_issues (
        id, user_id, project_id, code, title, description, status,
        priority, priority_label, assigned_to, asset, discipline, issue_type,
        due_date, created_by, identified_on,
        closed_by, closed_at_time, minutes_spent, notes, updated_at
      ) values (
        ${id}, ${context.userId}, ${data.projectId}, ${code},
        ${data.title || ""}, ${data.description || ""}, ${data.status || "open"},
        ${data.priority || ""}, ${data.priorityLabel || ""}, ${data.assignedTo || ""},
        ${data.asset || ""}, ${data.discipline || ""}, ${data.type || ""},
        ${data.dueDate || ""}, ${data.createdBy || ""}, ${data.identifiedOn || ""},
        ${data.closedBy || ""}, ${data.closedAtTime || ""}, ${data.minutesSpent || 0},
        ${data.notes || ""}, now()
      )
      on conflict (id) do update set
        code = excluded.code,
        title = excluded.title,
        description = excluded.description,
        status = excluded.status,
        priority = excluded.priority,
        priority_label = excluded.priority_label,
        assigned_to = excluded.assigned_to,
        asset = excluded.asset,
        discipline = excluded.discipline,
        issue_type = excluded.issue_type,
        due_date = excluded.due_date,
        created_by = excluded.created_by,
        identified_on = excluded.identified_on,
        closed_by = excluded.closed_by,
        closed_at_time = excluded.closed_at_time,
        minutes_spent = excluded.minutes_spent,
        notes = excluded.notes,
        updated_at = now()
      where dsr_issues.user_id = ${context.userId}
    `;
    return id;
  });

export const setIssueDisposition = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; disposition: IssueDisposition; note?: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await ensureIssueExtraColumns(sql);
    await sql`
      update dsr_issues set
        disposition = ${data.disposition},
        disposition_note = ${String(data.note || "").slice(0, 280)},
        updated_at = now()
      where id = ${data.id} and user_id = ${context.userId}
    `;
  });

export const deleteIssue = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    await sql`delete from dsr_issues where id = ${id} and user_id = ${context.userId}`;
  });

export const closeIssue = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id: string;
      closedBy: string;
      closedAtTime: string;
      minutesSpent: number;
      notes?: string;
      reopen?: boolean;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (data.reopen) {
      await sql`
        update dsr_issues set
          status = 'open', closed_by = '', closed_at_time = '', minutes_spent = 0, updated_at = now()
        where id = ${data.id} and user_id = ${context.userId}
      `;
      return;
    }
    await sql`
      update dsr_issues set
        status = 'fixed',
        closed_by = ${data.closedBy},
        closed_at_time = ${data.closedAtTime},
        minutes_spent = ${data.minutesSpent},
        notes = case when ${data.notes || ""} = '' then notes else ${data.notes || ""} end,
        updated_at = now()
      where id = ${data.id} and user_id = ${context.userId}
    `;
  });

export const upsertIssueFromPunch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      projectId: string;
      code: string;
      title?: string;
      closed?: boolean;
      closedBy?: string;
      closedAtTime?: string;
      minutesSpent?: number;
      notes?: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const owned = await sql<{ id: string }>`
      select id from dsr_projects where id = ${data.projectId} and user_id = ${context.userId}
    `;
    if (!owned[0]) throw new Error("Project not found");
    const code = normalizeIssueCode(data.code);
    if (!code) throw new Error("Issue code required");
    const existing = await sql<{ id: string; status: string }>`
      select id, status from dsr_issues
      where user_id = ${context.userId} and project_id = ${data.projectId} and code = ${code}
    `;
    const status = data.closed
      ? "fixed"
      : existing[0]?.status === "fixed"
        ? "fixed"
        : existing[0]?.status || "in_progress";
    if (existing[0]) {
      await sql`
        update dsr_issues set
          title = case when ${data.title || ""} = '' then title else ${data.title || ""} end,
          status = ${status},
          closed_by = case when ${!!data.closed} then ${data.closedBy || ""} else closed_by end,
          closed_at_time = case when ${!!data.closed} then ${data.closedAtTime || ""} else closed_at_time end,
          minutes_spent = case when ${!!data.closed} then ${data.minutesSpent || 0} else minutes_spent end,
          notes = case when ${data.notes || ""} = '' then notes else ${data.notes || ""} end,
          updated_at = now()
        where id = ${existing[0].id} and user_id = ${context.userId}
      `;
      return { id: existing[0].id, code };
    }
    const id = nid();
    await sql`
      insert into dsr_issues (
        id, user_id, project_id, code, title, description, status,
        closed_by, closed_at_time, minutes_spent, notes, updated_at
      ) values (
        ${id}, ${context.userId}, ${data.projectId}, ${code},
        ${data.title || code}, ${data.notes || ""}, ${status},
        ${data.closed ? data.closedBy || "" : ""},
        ${data.closed ? data.closedAtTime || "" : ""},
        ${data.minutesSpent || 0}, ${data.notes || ""}, now()
      )
    `;
    return { id, code };
  });

export const listIssuePhotos = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { projectId: string; code: string }) => d)
  .handler(async ({ context, data }) => {
    const code = normalizeIssueCode(data.code);
    const sql = await getSql();
    const problem = await sql<{
      id: string;
      issue_code: string;
      kind: string;
      mime: string;
      caption: string;
      fingerprint: string;
    }>`
      select id, issue_code, kind, mime, caption, left(data_b64, 80) as fingerprint
      from dsr_issue_photos
      where user_id = ${context.userId} and project_id = ${data.projectId} and issue_code = ${code}
      order by created_at
    `;
    const evidence = await sql<{
      id: string;
      mime: string;
      caption: string;
      work_date: string;
      fingerprint: string;
    }>`
      select p.id, p.mime, p.caption, r.work_date::text as work_date, left(p.data_b64, 80) as fingerprint
      from dsr_photos p
      join dsr_reports r on r.id = p.report_id
      where p.user_id = ${context.userId} and r.project_id = ${data.projectId}
        and p.cxalloy = ${code}
      order by r.work_date, p.sort_order
    `;
    const out: IssuePhoto[] = problem.map((p) => ({
      id: p.id,
      code,
      kind: (p.kind === "evidence" ? "evidence" : "problem") as IssuePhoto["kind"],
      mime: p.mime,
      caption: p.caption,
      workDate: "",
      fromReport: false,
    }));
    const seen = new Set(problem.map((p) => p.fingerprint));
    for (const p of evidence) {
      if (seen.has(p.fingerprint)) continue;
      seen.add(p.fingerprint);
      out.push({
        id: p.id,
        code,
        kind: "evidence",
        mime: p.mime,
        caption: p.caption,
        workDate: String(p.work_date || "").slice(0, 10),
        fromReport: true,
      });
    }
    return out;
  });

export const getIssuePhoto = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const issue = await sql<{
      id: string;
      mime: string;
      data_b64: string;
      caption: string;
    }>`
      select id, mime, data_b64, caption
      from dsr_issue_photos where id = ${id} and user_id = ${context.userId}
    `;
    if (issue[0]) {
      return {
        id: issue[0].id,
        mime: issue[0].mime,
        dataB64: issue[0].data_b64,
        caption: issue[0].caption,
      };
    }
    const report = await sql<Photo>`
      select id, caption, cxalloy, mime, sort_order as "sortOrder", data_b64 as "dataB64"
      from dsr_photos where id = ${id} and user_id = ${context.userId}
    `;
    return report[0]
      ? { id: report[0].id, mime: report[0].mime, dataB64: report[0].dataB64, caption: report[0].caption }
      : null;
  });

export const addIssuePhoto = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      projectId: string;
      code: string;
      kind: "problem" | "evidence";
      dataB64: string;
      mime?: string;
      caption?: string;
      sourceReportId?: string;
      workDate?: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    if (!data.dataB64 || data.dataB64.length > 2_500_000) {
      throw new Error("Photo is too large. Use a smaller picture.");
    }
    const sql = await getSql();
    const owned = await sql<{ id: string }>`
      select id from dsr_projects where id = ${data.projectId} and user_id = ${context.userId}
    `;
    if (!owned[0]) throw new Error("Project not found");
    const code = normalizeIssueCode(data.code);
    if (!code) throw new Error("Issue code required");
    const issue = await sql<{ code: string; title: string; description: string }>`
      select code, title, description from dsr_issues
      where user_id = ${context.userId} and project_id = ${data.projectId} and code = ${code}
      limit 1
    `;
    const caption =
      cleanField(data.caption || "", 420) ||
      (issue[0] ? issueEvidenceCaption(issue[0]) : code);
    let sourceReportId = data.sourceReportId || "";
    if (data.kind === "evidence" && !sourceReportId) {
      const day = String(data.workDate || "").slice(0, 10);
      if (day) {
        const today = await sql<{ id: string }>`
          select id from dsr_reports
          where user_id = ${context.userId}
            and project_id = ${data.projectId}
            and work_date = ${day}
          order by updated_at desc
          limit 1
        `;
        sourceReportId = today[0]?.id || "";
      }
    }
    const id = nid();
    await sql`
      insert into dsr_issue_photos (
        id, user_id, project_id, issue_code, kind, mime, data_b64, caption, source_report_id
      ) values (
        ${id}, ${context.userId}, ${data.projectId}, ${code}, ${data.kind},
        ${data.mime || "image/jpeg"}, ${data.dataB64}, ${caption}, ${sourceReportId || null}
      )
    `;
    if (data.kind === "evidence" && sourceReportId) {
      const max = await sql<{ m: number }>`
        select coalesce(max(sort_order), -1)::int as m from dsr_photos
        where report_id = ${sourceReportId}
      `;
      await sql`
        insert into dsr_photos (id, user_id, report_id, mime, data_b64, sort_order, caption, cxalloy)
        values (
          ${nid()}, ${context.userId}, ${sourceReportId},
          ${data.mime || "image/jpeg"}, ${data.dataB64}, ${(max[0]?.m ?? -1) + 1},
          ${caption}, ${code}
        )
      `;
    }
    return id;
  });

export const updateIssuePhoto = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; caption: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      update dsr_issue_photos
      set caption = ${cleanField(data.caption, 420)}
      where id = ${data.id} and user_id = ${context.userId}
    `;
  });

export const deleteIssuePhoto = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const row = await sql<{
      data_b64: string;
      issue_code: string;
      source_report_id: string | null;
    }>`
      select data_b64, issue_code, source_report_id
      from dsr_issue_photos where id = ${id} and user_id = ${context.userId}
    `;
    await sql`
      delete from dsr_issue_photos where id = ${id} and user_id = ${context.userId}
    `;
    const linked = row[0];
    if (linked?.source_report_id) {
      const fp = linked.data_b64.slice(0, 80);
      await sql`
        delete from dsr_photos
        where user_id = ${context.userId}
          and report_id = ${linked.source_report_id}
          and cxalloy = ${linked.issue_code}
          and left(data_b64, 80) = ${fp}
      `;
    }
  });

export const importCxalloyPdf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { projectId: string; pdfB64?: string; pasted?: string }) => d)
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const owned = await sql<{ id: string }>`
      select id from dsr_projects where id = ${data.projectId} and user_id = ${context.userId}
    `;
    if (!owned[0]) throw new Error("Project not found");

    let text = (data.pasted || "").trim();
    let photoBytes: Uint8Array | null = null;
    if (!text && data.pdfB64) {
      if (data.pdfB64.length > 8_000_000) throw new Error("PDF is too large.");
      const bytes = Uint8Array.from(atob(data.pdfB64), (c) => c.charCodeAt(0));
      photoBytes = bytes.slice();
      const { extractText } = await import("unpdf");
      const extracted = await extractText(bytes, { mergePages: true });
      text = extracted.text;
    }
    if (!text.trim()) {
      return {
        ok: false as const,
        error: "Could not read text from that file. Paste the issue list or use a text export.",
      };
    }

    let seeds = parseCxalloyDocument(text);
    if (seeds.length) {
      try {
        const refined = await refineCxalloyImport({
          data: {
            text: text.slice(0, 16_000),
            seeds: seeds.slice(0, 80).map((s) => ({
              code: s.code,
              title: s.title,
              description: s.description,
              status: s.status,
              priority: s.priority,
              asset: s.asset,
              assignedTo: s.assignedTo,
            })),
          },
        });
        if (refined.ok) {
          seeds = mergeCxalloySeeds(
            seeds,
            refined.issues.map((issue) => ({
              ...issue,
              status: issue.status || "in_progress",
              statusLabel: issue.status === "fixed" ? "CLOSED" : "IN PROGRESS",
              priority: issue.priority || "",
              priorityLabel: issue.priorityLabel || "",
              assignedTo: issue.assignedTo || "",
              asset: issue.asset || "",
              discipline: issue.discipline || "",
              type: issue.type || "",
              dueDate: issue.dueDate || "",
              createdBy: issue.createdBy || "",
              identifiedOn: issue.identifiedOn || "",
            })),
          );
        }
      } catch {
        /* keep parser seeds */
      }
    }
    if (seeds.length < 3) {
      const { parseCxalloyIssues } = await import("./ai.server");
      const parsed = await parseCxalloyIssues(text);
      if (!parsed.ok) {
        if (!seeds.length) return parsed;
      } else {
        const llmSeeds = parsed.issues.map((issue) => ({
          code: issue.code,
          title: issue.title,
          description: issue.description,
          status: (issue.status || "in_progress") as IssueStatus,
          statusLabel: issue.status === "fixed" ? "CLOSED" : "IN PROGRESS",
          priority: issue.priority || "",
          priorityLabel: issue.priorityLabel || "",
          assignedTo: issue.assignedTo || "",
          asset: issue.asset || "",
          discipline: issue.discipline || "",
          type: issue.type || "",
          dueDate: issue.dueDate || "",
          createdBy: issue.createdBy || "",
          identifiedOn: issue.identifiedOn || "",
        }));
        seeds = seeds.length ? mergeCxalloySeeds(seeds, llmSeeds) : llmSeeds;
      }
    }
    const result = await upsertSeeds(sql, context.userId, data.projectId, seeds);
    if (photoBytes) {
      try {
        const mapped = await extractCxalloyIssuePhotos(photoBytes);
        for (const { code, photos } of mapped) {
          const have = await sql<{ n: number }>`
            select count(*)::int as n from dsr_issue_photos
            where user_id = ${context.userId} and project_id = ${data.projectId}
              and issue_code = ${code} and kind = 'problem'
          `;
          if ((have[0]?.n || 0) > 0) continue;
          let sort = 0;
          for (const ph of photos) {
            if (ph.dataB64.length > 2_400_000) continue;
            await sql`
              insert into dsr_issue_photos (
                id, user_id, project_id, issue_code, kind, mime, data_b64, caption
              ) values (
                ${nid()}, ${context.userId}, ${data.projectId}, ${code},
                'problem', ${ph.mime}, ${ph.dataB64}, ${"Issue photo"}
              )
            `;
            sort += 1;
            if (sort >= 6) break;
          }
        }
      } catch {
        /* photos are extra; the issue list still imports */
      }
    }
    return result;
  });

export const importCxalloySeeds = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      projectId: string;
      seeds: IssueSeed[];
      photos?: { code: string; dataB64: string; mime?: string; caption?: string }[];
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const owned = await sql<{ id: string }>`
      select id from dsr_projects where id = ${data.projectId} and user_id = ${context.userId}
    `;
    if (!owned[0]) throw new Error("Project not found");
    const result = await upsertSeeds(sql, context.userId, data.projectId, data.seeds || []);
    let photosAdded = 0;
    for (const ph of (data.photos || []).slice(0, 12)) {
      const code = normalizeIssueCode(ph.code);
      if (!code || !ph.dataB64 || ph.dataB64.length > 2_400_000) continue;
      const have = await sql<{ n: number }>`
        select count(*)::int as n from dsr_issue_photos
        where user_id = ${context.userId} and project_id = ${data.projectId}
          and issue_code = ${code} and kind = 'problem'
          and left(data_b64, 80) = ${ph.dataB64.slice(0, 80)}
      `;
      if ((have[0]?.n || 0) > 0) continue;
      await sql`
        insert into dsr_issue_photos (
          id, user_id, project_id, issue_code, kind, mime, data_b64, caption
        ) values (
          ${nid()}, ${context.userId}, ${data.projectId}, ${code},
          'problem', ${ph.mime || "image/jpeg"}, ${ph.dataB64}, ${cleanField(ph.caption || "Issue photo", 420)}
        )
      `;
      photosAdded += 1;
    }
    return { ...result, photosAdded };
  });

export const seedMustangIssues = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((projectId: string) => projectId)
  .handler(async ({ context, data: projectId }) => {
    const sql = await getSql();
    const owned = await sql<{ id: string }>`
      select id from dsr_projects where id = ${projectId} and user_id = ${context.userId}
    `;
    if (!owned[0]) throw new Error("Project not found");
    return upsertSeeds(sql, context.userId, projectId, MUSTANG_ISSUES);
  });

async function codesClosedInReports(
  sql: Awaited<ReturnType<typeof getSql>>,
  userId: string,
  projectId: string,
) {
  const rows = await sql<{ entries: unknown }>`
    select entries from dsr_reports
    where user_id = ${userId} and project_id = ${projectId}
  `;
  const codes = new Set<string>();
  for (const row of rows) {
    for (const e of parseEntries(row.entries)) {
      for (const code of entryIssueCodes(e)) {
        if (entryMarksIssueClosed(e, code)) codes.add(code);
      }
    }
  }
  return codes;
}

async function upsertSeeds(
  sql: Awaited<ReturnType<typeof getSql>>,
  userId: string,
  projectId: string,
  seeds: IssueSeed[],
) {
  await ensureIssueExtraColumns(sql);
  let added = 0;
  let updated = 0;
  let keptFixed = 0;
  const closedFromReports = await codesClosedInReports(sql, userId, projectId);
  for (const issue of seeds) {
    const code = normalizeIssueCode(issue.code);
    if (!code) continue;
    const existing = await sql<{ id: string; status: string; disposition: string }>`
      select id, status, coalesce(disposition, 'ours') as disposition
      from dsr_issues
      where user_id = ${userId} and project_id = ${projectId} and code = ${code}
    `;
    const shouldClose =
      existing[0]?.status === "fixed" || closedFromReports.has(code) || issue.status === "fixed";
    const disposition = asDisposition(issue.disposition) !== "ours"
      ? asDisposition(issue.disposition)
      : asDisposition(existing[0]?.disposition);
    const dispositionNote = String(issue.dispositionNote || "").slice(0, 280);
    if (existing[0]) {
      if (shouldClose) keptFixed += 1;
      await sql`
        update dsr_issues set
          title = ${issue.title || issue.code},
          description = ${issue.description},
          priority = ${issue.priority || ""},
          priority_label = ${issue.priorityLabel || ""},
          assigned_to = ${issue.assignedTo || ""},
          asset = ${issue.asset || ""},
          discipline = ${issue.discipline || ""},
          issue_type = ${issue.type || ""},
          due_date = ${issue.dueDate || ""},
          created_by = ${issue.createdBy || ""},
          identified_on = ${issue.identifiedOn || ""},
          status = case when ${shouldClose} then 'fixed' else status end,
          closed_by = case
            when ${shouldClose} and closed_by = '' then 'Daily report'
            else closed_by
          end,
          disposition = ${disposition},
          disposition_note = case
            when ${dispositionNote} = '' then disposition_note
            else ${dispositionNote}
          end,
          last_import_at = now(),
          updated_at = now()
        where id = ${existing[0].id} and user_id = ${userId}
      `;
      updated += 1;
    } else {
      await sql`
        insert into dsr_issues (
          id, user_id, project_id, code, title, description, status,
          priority, priority_label, assigned_to, asset, discipline, issue_type,
          due_date, created_by, identified_on, closed_by, last_import_at,
          disposition, disposition_note
        ) values (
          ${nid()}, ${userId}, ${projectId}, ${code},
          ${issue.title || code}, ${issue.description},
          ${shouldClose ? "fixed" : issue.status || "in_progress"},
          ${issue.priority || ""}, ${issue.priorityLabel || ""}, ${issue.assignedTo || ""},
          ${issue.asset || ""}, ${issue.discipline || ""}, ${issue.type || ""},
          ${issue.dueDate || ""}, ${issue.createdBy || ""}, ${issue.identifiedOn || ""},
          ${shouldClose ? "Daily report" : ""}, now(),
          ${asDisposition(issue.disposition)}, ${String(issue.dispositionNote || "").slice(0, 280)}
        )
      `;
      added += 1;
    }
  }
  return { ok: true as const, added, updated, keptFixed, total: seeds.length };
}

function isBlank(v: string) {
  const t = String(v || "").trim();
  return !t || /^n\/?a$/i.test(t) || looksLikeFormChrome(t);
}

function keep(cur: string, next: string) {
  if (isBlank(next)) return cur;
  return isBlank(cur) ? next : cur;
}

function normName(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normTask(s: string) {
  return normName(s).slice(0, 140);
}

async function addPeople(
  sql: Awaited<ReturnType<typeof getSql>>,
  userId: string,
  projectId: string,
  names: string[],
) {
  for (const name of names) {
    const n = name.trim();
    if (!n) continue;
    const existing = await sql<{ id: string }>`
      select id from dsr_people
      where user_id = ${userId} and project_id = ${projectId} and lower(name) = ${n.toLowerCase()}
    `;
    if (existing[0]) continue;
    await sql`
      insert into dsr_people (id, user_id, project_id, name, initials, active)
      values (${nid()}, ${userId}, ${projectId}, ${n}, ${initialsFromName(n)}, true)
    `;
  }
}

async function findOrCreateJob(
  sql: Awaited<ReturnType<typeof getSql>>,
  userId: string,
  parsed: {
    customer: string;
    wo: string;
    location: string;
    po: string;
    chargeCode: string;
    transportation: string;
    generatorSize: string;
    qty: string;
    operatingVoltage: string;
    dcVoltage: string;
    switchgearMfr: string;
    prints: string;
    jobTask: string;
    technician: string;
    timeOn: string;
    timeOff: string;
    crewToday: string[];
  },
  folderHint: string,
) {
  const jobs = await sql<ProjectRow>`
    select * from dsr_projects where user_id = ${userId}
  `;
  const wo = validWorkOrder(parsed.wo);
  const cust = normName(parsed.customer);
  const loc = normName(parsed.location);
  const task = normTask(parsed.jobTask);
  const folder = folderHint.trim().toLowerCase();
  let hit =
    (wo ? jobs.find((j) => validWorkOrder(j.wo) === wo) : undefined) ||
    (cust
      ? jobs.find((j) => {
          const jc = normName(j.customer) || normName(j.name);
          if (jc !== cust) return false;
          const jl = normName(j.location);
          return !loc || !jl || jl === loc;
        })
      : undefined) ||
    (task.length >= 40 ? jobs.find((j) => normTask(j.job_task) === task) : undefined) ||
    (folder
      ? jobs.find(
          (j) =>
            j.name.trim().toLowerCase() === folder ||
            j.customer.trim().toLowerCase() === folder ||
            normName(j.name) === normName(folder) ||
            normName(j.customer) === normName(folder),
        )
      : undefined);

  if (hit) {
    const incomingName = parsed.customer || folderHint || (wo ? `WO ${wo}` : "");
    const weakName =
      isBlank(hit.name) ||
      /^imported job$/i.test(hit.name) ||
      (hit.job_task && hit.name.startsWith(String(hit.job_task).slice(0, 24)));
    const name = weakName && incomingName ? incomingName : keep(hit.name, incomingName);
    const customer = keep(hit.customer, parsed.customer);
    const woKeep = keep(hit.wo, parsed.wo);
    const location = keep(hit.location, parsed.location);
    const po = keep(hit.po, parsed.po);
    const charge = keep(hit.charge_code, parsed.chargeCode);
    const trans = keep(hit.transportation, parsed.transportation);
    const gen = keep(hit.generator_size, parsed.generatorSize);
    const qty = keep(hit.qty, parsed.qty);
    const op = keep(hit.operating_voltage, parsed.operatingVoltage);
    const dc = keep(hit.dc_voltage, parsed.dcVoltage);
    const mfr = keep(hit.switchgear_mfr, parsed.switchgearMfr);
    const prints = keep(hit.prints, parsed.prints);
    const task = keep(hit.job_task, parsed.jobTask);
    const tech = keep(hit.technician, parsed.technician);
    const initials = hit.initials || initialsFromName(tech);
    const crew = keep(hit.crew, parsed.crewToday.join(", "));
    await sql`
      update dsr_projects set
        name = ${name}, customer = ${customer}, wo = ${woKeep}, location = ${location},
        po = ${po}, charge_code = ${charge}, transportation = ${trans},
        generator_size = ${gen}, qty = ${qty}, operating_voltage = ${op}, dc_voltage = ${dc},
        switchgear_mfr = ${mfr}, prints = ${prints}, job_task = ${task},
        technician = ${tech}, initials = ${initials}, crew = ${crew}, updated_at = now()
      where id = ${hit.id} and user_id = ${userId}
    `;
    await addPeople(sql, userId, hit.id, [tech, ...parsed.crewToday]);
    return { ...hit, name, customer, wo: woKeep, location, technician: tech, initials, crew, created: false };
  }

  const id = nid();
  const technician = parsed.technician || "";
  const initials = initialsFromName(technician) || "XXX";
  const name =
    parsed.customer ||
    folderHint ||
    (wo ? `WO ${wo}` : "") ||
    parsed.location ||
    (parsed.jobTask ? parsed.jobTask.slice(0, 52) : "") ||
    "Imported job";
  const crew = parsed.crewToday.join(", ");
  await sql`
    insert into dsr_projects (
      id, user_id, name, customer, wo, location, po, charge_code, transportation,
      generator_size, qty, operating_voltage, dc_voltage, switchgear_mfr, prints,
      job_task, technician, initials, default_time_on, default_time_off, crew, updated_at
    ) values (
      ${id}, ${userId}, ${name}, ${parsed.customer}, ${parsed.wo}, ${parsed.location},
      ${parsed.po}, ${parsed.chargeCode}, ${parsed.transportation || "Rental Car / Flight / Service Truck"},
      ${parsed.generatorSize}, ${parsed.qty}, ${parsed.operatingVoltage}, ${parsed.dcVoltage},
      ${parsed.switchgearMfr}, ${parsed.prints}, ${parsed.jobTask}, ${technician}, ${initials},
      ${parsed.timeOn || "0700"}, ${parsed.timeOff || "2000"}, ${crew}, now()
    )
  `;
  await addPeople(sql, userId, id, [technician, ...parsed.crewToday]);
  return {
    id,
    name,
    customer: parsed.customer || name,
    wo: parsed.wo,
    location: parsed.location,
    initials,
    default_time_on: parsed.timeOn || "0700",
    default_time_off: parsed.timeOff || "2000",
    crew,
    technician,
    created: true,
  };
}

export const importParsedDay = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      projectId?: string;
      folderHint?: string;
      parsed: {
        workDate: string;
        reportNo: string;
        timeOn: string;
        timeOff: string;
        mileage: string;
        estimatedCost: string;
        materialUsed: string;
        partsNeededText: string;
        comments: string;
        technician: string;
        entries: TimelineEntry[];
        crewToday: string[];
        customer: string;
        wo: string;
        location: string;
        po: string;
        chargeCode: string;
        transportation: string;
        generatorSize: string;
        qty: string;
        operatingVoltage: string;
        dcVoltage: string;
        switchgearMfr: string;
        prints: string;
        jobTask: string;
      };
    }) => d,
  )
  .handler(async ({ context, data }) => {
    try {
      const sql = await getSql();
      const parsed = data.parsed;
      if (!parsed?.workDate) return { ok: false as const, error: "That report has no date." };

      async function existingForDay(projectId: string, day: string) {
        if (!projectId || !day) return undefined;
        const rows = await sql<ReportRow>`
          select * from dsr_reports
          where user_id = ${context.userId} and project_id = ${projectId} and work_date = ${day}
          limit 1
        `;
        return rows[0];
      }

      let jobCreated = false;
      let projectId = data.projectId || "";
      let owned: {
        id: string;
        initials: string;
        default_time_on: string;
        default_time_off: string;
        crew: string;
        name?: string;
      };

      if (projectId) {
        const rows = await sql<{
          id: string;
          initials: string;
          default_time_on: string;
          default_time_off: string;
          crew: string;
          name: string;
        }>`
          select id, initials, default_time_on, default_time_off, crew, name
          from dsr_projects where id = ${projectId} and user_id = ${context.userId}
        `;
        if (!rows[0]) return { ok: false as const, error: "Job not found." };
        owned = rows[0];
      } else {
        const job = await findOrCreateJob(sql, context.userId, parsed, data.folderHint || "");
        projectId = job.id;
        jobCreated = job.created;
        owned = {
          id: job.id,
          initials: job.initials,
          default_time_on: job.default_time_on,
          default_time_off: job.default_time_off,
          crew: job.crew,
          name: job.name,
        };
      }

      const dayHit = await existingForDay(projectId, parsed.workDate);
      if (dayHit) {
        return {
          ok: true as const,
          skipped: true,
          created: false,
          jobCreated,
          projectId,
          jobName: owned.name || "",
          reportId: dayHit.id,
          workDate: parsed.workDate,
          reportNo: dayHit.report_no,
        };
      }

      const reportNo =
        cleanReportNo(parsed.reportNo) || makeReportNo(parsed.workDate, owned.initials);
      const crewToday =
        parsed.crewToday.length > 0 ? parsed.crewToday : namesFromCrew(owned.crew);
      const comments = cleanField(
        parsed.comments ||
          (crewToday.length ? `Work day. Crew on site: ${crewToday.join(", ")}.` : "Work day."),
        500,
      );
      const reportId = nid();
      try {
        await sql`
          insert into dsr_reports (
            id, user_id, project_id, work_date, report_no, time_on, time_off,
            mileage, estimated_cost, material_used, parts_needed_text, comments, entries, crew_today
          ) values (
            ${reportId}, ${context.userId}, ${projectId}, ${parsed.workDate}, ${reportNo},
            ${parsed.timeOn || owned.default_time_on},
            ${parsed.timeOff || owned.default_time_off},
            ${parsed.mileage || "N/A"}, ${parsed.estimatedCost || "N/A"},
            ${parsed.materialUsed || "N/A"}, ${parsed.partsNeededText || "See parts list."},
            ${comments}, ${JSON.stringify(parsed.entries || [])}::jsonb, ${JSON.stringify(crewToday)}::jsonb
          )
        `;
      } catch {
        const again = await existingForDay(projectId, parsed.workDate);
        if (again) {
          return {
            ok: true as const,
            skipped: true,
            created: false,
            jobCreated,
            projectId,
            jobName: owned.name || "",
            reportId: again.id,
            workDate: parsed.workDate,
            reportNo: again.report_no,
          };
        }
        return { ok: false as const, error: "Could not save that day." };
      }

      await sql`
        update dsr_projects set updated_at = now()
        where id = ${projectId} and user_id = ${context.userId}
      `;

      const closedBy = parsed.technician || crewToday[0] || "";
      for (const e of parsed.entries || []) {
        for (const code of entryIssueCodes(e)) {
        const existing = await sql<{ id: string; status: string }>`
          select id, status from dsr_issues
          where user_id = ${context.userId} and project_id = ${projectId} and code = ${code}
          limit 1
        `;
        if (!existing[0]) continue;
        const closed = entryMarksIssueClosed(e, code);
        const status = closed ? "fixed" : existing[0].status === "fixed" ? "fixed" : "in_progress";
        await sql`
          update dsr_issues set
            status = ${status},
            closed_by = case when ${closed} then ${closedBy} else closed_by end,
            closed_at_time = case when ${closed} then ${e.time || ""} else closed_at_time end,
            notes = case when ${e.text || ""} = '' then notes else ${cleanField(e.text || "", 500)} end,
            updated_at = now()
          where id = ${existing[0].id} and user_id = ${context.userId}
        `;
        }
      }

      return {
        ok: true as const,
        skipped: false,
        created: true,
        jobCreated,
        projectId,
        jobName: owned.name || parsed.customer || "",
        reportId,
        workDate: parsed.workDate,
        reportNo,
      };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : "Could not import that day.",
      };
    }
  });

async function autoTagReportPhotos(
  sql: Sql,
  userId: string,
  reportId: string,
) {
  const rows = await sql<{ entries: unknown }>`
    select entries from dsr_reports where id = ${reportId} and user_id = ${userId}
  `;
  if (!rows[0]) return;
  const codes = [
    ...new Set(parseEntries(rows[0].entries).flatMap((e) => entryClosedCodes(e))),
  ];
  if (codes.length !== 1) return;
  const code = codes[0];
  await sql`
    update dsr_photos set cxalloy = ${code}
    where report_id = ${reportId} and user_id = ${userId} and cxalloy = ''
  `;
}

export const addPhotosBatch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { reportId: string; photos: { dataB64: string; mime?: string }[] }) => d)
  .handler(async ({ context, data }) => {
    try {
      const sql = await getSql();
      const owned = await sql<{ id: string }>`
        select id from dsr_reports where id = ${data.reportId} and user_id = ${context.userId}
      `;
      if (!owned[0]) return { ok: false as const, added: 0, error: "Report not found" };
      const max = await sql<{ m: number }>`
        select coalesce(max(sort_order), -1)::int as m from dsr_photos
        where report_id = ${data.reportId}
      `;
      let sort = Number(max[0]?.m ?? -1) + 1;
      let added = 0;
      for (const ph of (data.photos || []).slice(0, 12)) {
        if (!ph?.dataB64 || ph.dataB64.length > 1_600_000) continue;
        try {
          await sql`
            insert into dsr_photos (id, user_id, report_id, mime, data_b64, sort_order)
            values (${nid()}, ${context.userId}, ${data.reportId}, ${ph.mime || "image/jpeg"}, ${ph.dataB64}, ${sort})
          `;
          sort += 1;
          added += 1;
        } catch {
          continue;
        }
      }
      if (added) await autoTagReportPhotos(sql, context.userId, data.reportId);
      return { ok: true as const, added };
    } catch (e) {
      return {
        ok: false as const,
        added: 0,
        error: e instanceof Error ? e.message : "Could not save photos",
      };
    }
  });

export const importDsrPdf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      projectId?: string;
      pdfB64: string;
      filename?: string;
      folderHint?: string;
      skipLlm?: boolean;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    try {
    const sql = await getSql();
    if (!data.pdfB64) return { ok: false as const, error: "No file received." };
    if (data.pdfB64.length > 8_000_000) {
      return { ok: false as const, error: "That PDF is too large to import." };
    }

    async function existingForDay(projectId: string, day: string) {
      if (!projectId || !day) return undefined;
      const rows = await sql<ReportRow>`
        select * from dsr_reports
        where user_id = ${context.userId} and project_id = ${projectId} and work_date = ${day}
        order by updated_at desc
        limit 1
      `;
      return rows[0];
    }

    if (data.projectId) {
      const namedDate = dateFromFilename(data.filename || "");
      const namedHit = await existingForDay(data.projectId, namedDate);
      if (namedHit) {
        return {
          ok: true as const,
          skipped: true,
          created: false,
          jobCreated: false,
          projectId: data.projectId,
          jobName: "",
          reportId: namedHit.id,
          workDate: namedDate,
          reportNo: namedHit.report_no,
          entryCount: parseEntries(namedHit.entries).length,
          photosAdded: 0,
        };
      }
    }

    const bytes = Uint8Array.from(atob(data.pdfB64), (c) => c.charCodeAt(0));
    const wantPhotos = bytes.length < 3_200_000;
    const photoBytes = wantPhotos ? bytes.slice() : null;
    const { extractText } = await import("unpdf");
    let text = "";
    try {
      const extracted = await extractText(bytes, { mergePages: true });
      text = extracted.text;
    } catch {
      return { ok: false as const, error: "Could not read that PDF." };
    }
    if (looksLikeCxalloyList(text)) {
      return {
        ok: false as const,
        error: "That looks like a CXAlloy issue list. Import it under CXAlloy issues instead.",
      };
    }

    let parsed = parseDsrText(text, data.filename || "");
    if (!data.skipLlm && parsed.entries.length < 2) {
      const { llmParseDsr } = await import("./ai.server");
      const llm = await llmParseDsr(text);
      if (llm.ok && (llm.parsed.entries?.length || 0) > parsed.entries.length) {
        const p = llm.parsed;
        parsed = {
          ...parsed,
          workDate: parsed.workDate || String(p.workDate || ""),
          reportNo: parsed.reportNo || String(p.reportNo || "").replace(/[^\w]/g, ""),
          timeOn: parsed.timeOn || String(p.timeOn || parsed.timeOn),
          timeOff: parsed.timeOff || String(p.timeOff || parsed.timeOff),
          mileage: parsed.mileage || String(p.mileage || ""),
          estimatedCost: parsed.estimatedCost || String(p.estimatedCost || ""),
          materialUsed: parsed.materialUsed || String(p.materialUsed || ""),
          partsNeededText: parsed.partsNeededText || String(p.partsNeededText || ""),
          comments: parsed.comments || String(p.comments || ""),
          technician: parsed.technician || String(p.technician || ""),
          entries: (p.entries || []).map((e) =>
            emptyPunch({
              time: String(e.time || ""),
              endTime: String(e.endTime || ""),
              text: String(e.text || ""),
              cxalloy: String(e.cxalloy || ""),
              workers: Array.isArray(e.workers) ? e.workers.map(String) : [],
              kind: e.kind === "standby" ? "standby" : "work",
            }),
          ),
        };
      }
    }

    if (!parsed.workDate) {
      return {
        ok: false as const,
        error: "Could not read the date on that PDF. Rename it like 09.05.2026.pdf and try again.",
      };
    }

    let jobCreated = false;
    let projectId = data.projectId || "";
    let owned: {
      id: string;
      initials: string;
      default_time_on: string;
      default_time_off: string;
      crew: string;
      name?: string;
    };
    if (projectId) {
      const rows = await sql<{
        id: string;
        initials: string;
        default_time_on: string;
        default_time_off: string;
        crew: string;
        name: string;
      }>`
        select id, initials, default_time_on, default_time_off, crew, name
        from dsr_projects where id = ${projectId} and user_id = ${context.userId}
      `;
      if (!rows[0]) throw new Error("Project not found");
      owned = rows[0];
    } else {
      const job = await findOrCreateJob(sql, context.userId, parsed, data.folderHint || "");
      projectId = job.id;
      jobCreated = job.created;
      owned = {
        id: job.id,
        initials: job.initials,
        default_time_on: job.default_time_on,
        default_time_off: job.default_time_off,
        crew: job.crew,
        name: job.name,
      };
    }

    const dayHit = await existingForDay(projectId, parsed.workDate);
    if (dayHit) {
      return {
        ok: true as const,
        skipped: true,
        created: false,
        jobCreated,
        projectId,
        jobName: owned.name || "",
        reportId: dayHit.id,
        workDate: parsed.workDate,
        reportNo: dayHit.report_no,
        entryCount: parseEntries(dayHit.entries).length,
        photosAdded: 0,
      };
    }

    const reportNo = cleanReportNo(parsed.reportNo) || makeReportNo(parsed.workDate, owned.initials);
    const crewToday =
      parsed.crewToday.length > 0 ? parsed.crewToday : namesFromCrew(owned.crew);
    const comments = cleanField(
      parsed.comments ||
        (crewToday.length ? `Work day. Crew on site: ${crewToday.join(", ")}.` : "Work day."),
      500,
    );

    const entriesJson = JSON.stringify(parsed.entries);
    const crewJson = JSON.stringify(crewToday);
    const reportId = nid();
    try {
      await sql`
        insert into dsr_reports (
          id, user_id, project_id, work_date, report_no, time_on, time_off,
          mileage, estimated_cost, material_used, parts_needed_text, comments, entries, crew_today
        ) values (
          ${reportId}, ${context.userId}, ${projectId}, ${parsed.workDate}, ${reportNo},
          ${parsed.timeOn || owned.default_time_on},
          ${parsed.timeOff || owned.default_time_off},
          ${parsed.mileage || "N/A"}, ${parsed.estimatedCost || "N/A"},
          ${parsed.materialUsed || "N/A"}, ${parsed.partsNeededText || "See parts list."},
          ${comments}, ${entriesJson}::jsonb, ${crewJson}::jsonb
        )
      `;
    } catch {
      const again = await existingForDay(projectId, parsed.workDate);
      if (again) {
        return {
          ok: true as const,
          skipped: true,
          created: false,
          jobCreated,
          projectId,
          jobName: owned.name || "",
          reportId: again.id,
          workDate: parsed.workDate,
          reportNo: again.report_no,
          entryCount: parseEntries(again.entries).length,
          photosAdded: 0,
        };
      }
      return { ok: false as const, error: "Could not save that day (it may already exist)." };
    }

    let photosAdded = 0;
    if (photoBytes) {
      try {
        const photos = await extractDsrPhotos(photoBytes);
        let sort = 0;
        for (const ph of photos) {
          if (ph.dataB64.length > 700_000) continue;
          await sql`
            insert into dsr_photos (id, user_id, report_id, mime, data_b64, sort_order)
            values (${nid()}, ${context.userId}, ${reportId}, ${ph.mime}, ${ph.dataB64}, ${sort})
          `;
          sort += 1;
          photosAdded += 1;
          if (photosAdded >= 8) break;
        }
      } catch {
        photosAdded = 0;
      }
    }

    await sql`
      update dsr_projects set updated_at = now()
      where id = ${projectId} and user_id = ${context.userId}
    `;

    return {
      ok: true as const,
      skipped: false,
      created: true,
      jobCreated,
      projectId,
      jobName: owned.name || parsed.customer || "",
      reportId,
      workDate: parsed.workDate,
      reportNo,
      entryCount: parsed.entries.length,
      photosAdded,
    };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : "Could not import that PDF.",
      };
    }
  });

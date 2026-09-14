import type { Issue, IssueDisposition, IssueStatus } from "./types";

export function normalizeIssueCode(raw: string) {
  const t = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  const m = t.match(/^(CHK|FO)-?(\d+)(?:-(\d+))?$/);
  if (!m) return t.replace(/[^A-Z0-9-]/g, "").slice(0, 24);
  return m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
}

export function issueEvidenceCaption(issue: {
  code: string;
  title?: string;
  description?: string;
}) {
  return normalizeIssueCode(issue.code) || String(issue.code || "").trim();
}

export function photoCaptionLabel(cxalloy?: string, caption?: string) {
  const code = String(cxalloy || "").trim();
  const cap = String(caption || "").trim();
  if (!code) return cap;
  if (!cap) return code;
  if (cap.toUpperCase().includes(code.toUpperCase())) return cap;
  return `${code} · ${cap}`;
}

/** Official PDF photo line: CXAlloy id only, never title or description. */
export function photoPdfCaption(cxalloy?: string, caption?: string) {
  const tagged = String(cxalloy || "").trim();
  if (tagged) return normalizeIssueCode(tagged);
  const cap = String(caption || "").trim();
  if (!cap) return "";
  const m = cap.match(/\b((?:CHK|FO)[-\s]?\d+(?:[-\s]\d+)?)\b/i);
  return m ? normalizeIssueCode(m[1]) : "";
}

export function parseIssueCodes(raw: unknown): string[] {
  const bits: string[] = [];
  const walk = (v: unknown) => {
    if (v == null || v === false) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    const s = String(v || "").trim();
    if (!s) return;
    for (const part of s.split(/[,;/|]+/)) {
      const t = part.trim();
      if (t) bits.push(t);
    }
  };
  walk(raw);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const b of bits) {
    const c = normalizeIssueCode(b);
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

export function stampIssueCodes(codes: unknown): { cxalloy: string; cxalloys: string[] } {
  const cxalloys = parseIssueCodes(codes);
  return { cxalloys, cxalloy: cxalloys[0] || "" };
}

export function entryIssueCodes(e: { cxalloy?: string; cxalloys?: string[] }): string[] {
  return parseIssueCodes([...(e.cxalloys || []), e.cxalloy || ""]);
}

export function entryClosedCodes(e: {
  cxalloy?: string;
  cxalloys?: string[];
  closed?: boolean;
  closedCodes?: string[];
}): string[] {
  const codes = entryIssueCodes(e);
  const listed = parseIssueCodes(e.closedCodes).filter((c) => codes.includes(c));
  if (listed.length) return listed;
  if (e.closed) return codes;
  return [];
}

export type IssueSeed = {
  code: string;
  title: string;
  description: string;
  status: IssueStatus;
  statusLabel: string;
  priority: string;
  priorityLabel: string;
  assignedTo: string;
  asset: string;
  discipline: string;
  type: string;
  dueDate: string;
  createdBy: string;
  identifiedOn: string;
  disposition?: IssueDisposition;
  dispositionNote?: string;
};

export type IssueFilters = {
  q: string;
  status: "" | IssueStatus;
  priority: string;
  asset: string;
  type: string;
  discipline: string;
  disposition: "" | IssueDisposition;
};

export const EMPTY_FILTERS: IssueFilters = {
  q: "",
  status: "",
  priority: "",
  asset: "",
  type: "",
  discipline: "",
  disposition: "",
};

const DISP_RANK: Record<IssueDisposition, number> = {
  ours: 0,
  reassigned: 1,
  disputed: 2,
  needs_engineering: 3,
  as_designed: 4,
};

export function inferDisposition(text: string): { disposition: IssueDisposition; note: string } {
  const t = String(text || "");
  if (
    /reassign(ed|ing)?(\s+to)?|not (mcg|m\.?c\.?g|our (scope|issue|work))|wrong (trade|contractor)|not responsible/i.test(
      t,
    )
  ) {
    return { disposition: "reassigned", note: "Reassigned / not MCG scope" };
  }
  if (
    /as[- ]designed|as conceived|by design|how it was (designed|built|conceived)|that is how it was/i.test(
      t,
    )
  ) {
    return { disposition: "as_designed", note: "As designed / as conceived — not a field defect" };
  }
  if (/engineer(ing)? (to )?(review|verify)|needs engineering|design (team|review)/i.test(t)) {
    return { disposition: "needs_engineering", note: "Engineering should confirm if this is an issue" };
  }
  if (/disput|not an issue|inspector (said|called|flagged)|disagree|false (positive|issue)/i.test(t)) {
    return { disposition: "disputed", note: "In dispute — inspector call vs how it was built" };
  }
  return { disposition: "ours", note: "" };
}

export function pickDisposition(a: IssueDisposition | undefined, b: IssueDisposition | undefined): IssueDisposition {
  const left = a && a in DISP_RANK ? a : "ours";
  const right = b && b in DISP_RANK ? b : "ours";
  return DISP_RANK[right] > DISP_RANK[left] ? right : left;
}

export function dispositionLabel(d: IssueDisposition | string) {
  if (d === "reassigned") return "Reassigned";
  if (d === "disputed") return "In dispute";
  if (d === "as_designed") return "As designed";
  if (d === "needs_engineering") return "Needs engineering";
  return "MCG to fix";
}

export function dispositionTone(d: IssueDisposition | string) {
  if (d === "reassigned") return "bg-muted/20 text-muted";
  if (d === "disputed") return "bg-danger/10 text-danger";
  if (d === "as_designed") return "bg-cyan/15 text-navy";
  if (d === "needs_engineering") return "bg-cyan/15 text-navy";
  return "";
}

const JUNK = [
  /^Construction Issues/i,
  /^Holder Construction/i,
  /^Printed on/i,
  /^Page \d+/i,
  /^\d+ Issues sorted/i,
  /^IMG[_-]/i,
  /^TC_\d+/i,
  /^Image \(/i,
  /^\(Upload-from-/i,
  /^[0-9a-f]{8}-[0-9a-f-]{27}\./i,
  /commented on /i,
  /^Equipment Vendor,/i,
  /^General Contractor,/i,
  /^Please provide photos/i,
  /^Please add a photo/i,
  /^Moving to /i,
  /^Requested images/i,
  /^Davis - video/i,
  /^Labels have been ordered/i,

  /^The photo you attached/i,
  /^My photos show this bolt/i,
];

function isJunk(line: string) {
  const t = line.trim();
  if (!t) return true;
  if (/\.(heic|jpe?g|png)$/i.test(t)) return true;
  if (/^(CHK|FO)-[\w-]+\s+\S+\.(jpeg|jpg|png|heic)/i.test(t)) return true;
  return JUNK.some((r) => r.test(t));
}

const HEADER =
  /^((?:CHK|FO)-[\w-]+)\s+(IN PROGRESS|OPEN|CLOSED|FIXED|COMPLETE)?\s*(P[123])?(?:\s*\((HIGH|MODERATE|LOW)\))?/i;
const FIELD =
  /^(Assigned To|Asset|Discipline|Type|Due Date|Created By|Identified On)\s+(.*)$/i;

function priorityLabel(p: string) {
  if (p === "P1") return "HIGH";
  if (p === "P2") return "MODERATE";
  if (p === "P3") return "LOW";
  return "";
}

function mapStatus(raw: string): IssueStatus {
  const s = raw.toUpperCase();
  if (s.includes("FIXED") || s.includes("CLOSED") || s.includes("COMPLETE")) return "fixed";
  if (s.includes("PROGRESS")) return "in_progress";
  return "open";
}

function looksLikeJunkTitle(s: string, code: string) {
  const t = String(s || "").trim();
  if (!t || t === code) return true;
  if (/\.(heic|jpe?g|png)$/i.test(t)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f-]{20,}\./i.test(t)) return true;
  return false;
}

export function mergeCxalloySeeds(base: IssueSeed[], llm: Partial<IssueSeed>[]): IssueSeed[] {
  const byLlm = new Map<string, Partial<IssueSeed>>();
  for (const i of llm || []) {
    const code = normalizeIssueCode(String(i.code || ""));
    if (code) byLlm.set(code, i);
  }
  const used = new Set<string>();
  const out: IssueSeed[] = base.map((seed) => {
    const code = normalizeIssueCode(seed.code);
    used.add(code);
    const hit = byLlm.get(code);
    if (!hit) return seed;
    const llmStatus = hit.status;
    const status: IssueStatus =
      seed.status === "fixed" || llmStatus === "fixed"
        ? "fixed"
        : llmStatus === "open" || llmStatus === "in_progress"
          ? llmStatus
          : seed.status;
    const title =
      looksLikeJunkTitle(seed.title, seed.code) && hit.title
        ? String(hit.title)
        : seed.title || String(hit.title || seed.code);
    const desc = String(hit.description || "").trim();
    return {
      ...seed,
      title: title.slice(0, 180),
      description: (desc.length > seed.description.length ? desc : seed.description || desc).slice(0, 1200),
      status,
      statusLabel: status === "fixed" ? "CLOSED" : status === "open" ? "OPEN" : seed.statusLabel || "IN PROGRESS",
      priority: seed.priority || String(hit.priority || ""),
      priorityLabel: seed.priorityLabel || String(hit.priorityLabel || ""),
      assignedTo: seed.assignedTo || String(hit.assignedTo || ""),
      asset: seed.asset || String(hit.asset || ""),
      discipline: seed.discipline || String(hit.discipline || ""),
      type: seed.type || String(hit.type || ""),
      dueDate: seed.dueDate || String(hit.dueDate || ""),
      createdBy: seed.createdBy || String(hit.createdBy || ""),
      identifiedOn: seed.identifiedOn || String(hit.identifiedOn || ""),
      disposition: pickDisposition(seed.disposition, hit.disposition),
      dispositionNote:
        pickDisposition(seed.disposition, hit.disposition) === "ours"
          ? ""
          : String(hit.dispositionNote || seed.dispositionNote || "").slice(0, 280),
    };
  });
  for (const [code, hit] of byLlm) {
    if (used.has(code) || !/^(CHK|FO)-/i.test(code)) continue;
    out.push({
      code,
      title: String(hit.title || code).slice(0, 180),
      description: String(hit.description || "").slice(0, 1200),
      status: hit.status === "fixed" || hit.status === "open" ? hit.status : "in_progress",
      statusLabel: hit.status === "fixed" ? "CLOSED" : "IN PROGRESS",
      priority: String(hit.priority || ""),
      priorityLabel: String(hit.priorityLabel || ""),
      assignedTo: String(hit.assignedTo || ""),
      asset: String(hit.asset || ""),
      discipline: String(hit.discipline || ""),
      type: String(hit.type || ""),
      dueDate: String(hit.dueDate || ""),
      createdBy: String(hit.createdBy || ""),
      identifiedOn: String(hit.identifiedOn || ""),
      disposition: hit.disposition && hit.disposition !== "ours" ? hit.disposition : "ours",
      dispositionNote: String(hit.dispositionNote || "").slice(0, 280),
    });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

function richness(i: IssueSeed) {
  return [i.asset, i.title, i.description, i.priority, i.discipline, i.type, i.dueDate, i.createdBy]
    .filter((v) => v && v !== i.code)
    .join("").length;
}

/** Deterministic parse of a CXAlloy Construction Issues PDF/text export. */
export function parseCxalloyDocument(text: string): IssueSeed[] {
  const blocks: IssueSeed[] = [];
  let cur: (IssueSeed & { parts: string[] }) | null = null;

  const flush = () => {
    if (!cur) return;
    let title = cur.parts.join(" ").replace(/\s+/g, " ").trim();
    title = title.replace(/\s*Assigned To Mission Critical Group\s*/gi, " ").trim();
    cur.title = (title.split(/(?<=[.!?])\s/)[0] || cur.code).slice(0, 180);
    cur.description = title || cur.title;
    const inferred = inferDisposition(`${cur.title} ${cur.description} ${cur.assignedTo}`);
    if (inferred.disposition !== "ours") {
      cur.disposition = inferred.disposition;
      cur.dispositionNote = inferred.note;
    }
    delete (cur as { parts?: string[] }).parts;
    blocks.push(cur);
    cur = null;
  };

  for (const rawLine of text.split(/\n/)) {
    const t = rawLine.trim();
    const hm = t.match(HEADER);
    const looksHeader =
      hm &&
      /^(CHK|FO)-/i.test(hm[1]) &&
      !/\.(jpeg|jpg|png|heic)/i.test(t) &&
      (hm[2] || hm[3] || /^((?:CHK|FO)-[\w-]+)$/i.test(t));
    if (looksHeader && hm) {
      flush();
      const pri = (hm[3] || "").toUpperCase();
      const st = (hm[2] || "IN PROGRESS").toUpperCase();
      cur = {
        code: hm[1].toUpperCase(),
        title: "",
        description: "",
        status: mapStatus(st),
        statusLabel: st,
        priority: pri,
        priorityLabel: (hm[4] || priorityLabel(pri)).toUpperCase(),
        assignedTo: "",
        asset: "",
        discipline: "",
        type: "",
        dueDate: "",
        createdBy: "",
        identifiedOn: "",
        disposition: "ours",
        dispositionNote: "",
        parts: [],
      };
      const rest = t.slice(hm[0].length).trim();
      if (rest) cur.parts.push(rest);
      continue;
    }
    if (!cur) continue;
    const fm = t.match(FIELD);
    if (fm) {
      const k = fm[1].toLowerCase();
      const v = fm[2].trim();
      if (k === "assigned to") cur.assignedTo = v;
      else if (k === "asset") cur.asset = v.replace(/^[○•]\s*/, "");
      else if (k === "discipline") cur.discipline = v;
      else if (k === "type") cur.type = v;
      else if (k === "due date") cur.dueDate = v;
      else if (k === "created by") cur.createdBy = v;
      else if (k === "identified on") cur.identifiedOn = v;
      continue;
    }
    if (isJunk(t)) continue;
    const split = t.split(/\s+Assigned To\s+/i);
    if (split.length === 2) {
      if (split[0].trim()) cur.parts.push(split[0].trim());
      cur.assignedTo = split[1].trim();
      continue;
    }
    cur.parts.push(t);
  }
  flush();

  const by = new Map<string, IssueSeed>();
  for (const i of blocks) {
    const prev = by.get(i.code);
    by.set(i.code, prev && richness(prev) >= richness(i) ? prev : i);
  }
  return [...by.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

export function filterIssues<T extends IssueSeed | Issue>(list: T[], f: IssueFilters): T[] {
  const q = f.q.trim().toLowerCase();
  return list.filter((i) => {
    if (f.status && i.status !== f.status) return false;
    if (f.priority && i.priority !== f.priority) return false;
    if (f.asset && i.asset !== f.asset) return false;
    if (f.type && i.type !== f.type) return false;
    if (f.discipline && i.discipline !== f.discipline) return false;
    if (f.disposition && "disposition" in i && i.disposition !== f.disposition) return false;
    if (!q) return true;
    const hay = [i.code, i.title, i.description, i.asset, i.createdBy, i.assignedTo]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function uniqueValues(list: Issue[], key: keyof Issue) {
  return [...new Set(list.map((i) => String(i[key] ?? "")).filter(Boolean))].sort();
}

export function priorityTone(p: string) {
  if (p === "P1") return "bg-danger/10 text-danger";
  if (p === "P2") return "bg-cyan/15 text-navy";
  return "bg-muted/15 text-muted";
}

export function statusLabel(s: IssueStatus) {
  if (s === "fixed") return "Fixed";
  if (s === "in_progress") return "In progress";
  return "Open";
}

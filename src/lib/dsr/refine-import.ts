import { entryIssueCodes, normalizeIssueCode, stampIssueCodes } from "./cxalloy.ts";
import { cleanField, validWorkOrder, type ParsedDsr } from "./parse-dsr.ts";
import { emptyPunch, entryMarksIssueClosed } from "./timeline.ts";
import { normalizeHhmm } from "../utils.ts";
import type { TimelineEntry } from "./types";

export type IssueHint = { code: string; title: string; description?: string };

const STOP = new Set(
  "the and a an of to on in for with at from was were is that this it as by or be we they our work issue section phase after before into onto over under also just then than using used".split(
    " ",
  ),
);

function tokens(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOP.has(t));
}

/** Unique catalog hit from a punch that describes the issue but omits the CHK/FO code. */
export function matchIssueFromCatalog(text: string, catalog: IssueHint[]): string {
  const hayToks = tokens(text);
  if (hayToks.length < 2 || !catalog.length) return "";
  const hay = new Set(hayToks);
  let bestCode = "";
  let best = 0;
  let second = 0;
  for (const issue of catalog) {
    const titleToks = tokens(issue.title);
    const blob = tokens(`${issue.title} ${issue.description || ""}`);
    if (titleToks.length + blob.length < 2) continue;
    const titleHits = titleToks.filter((t) => hay.has(t)).length;
    const blobHits = blob.filter((t) => hay.has(t)).length;
    const titleScore = titleToks.length ? titleHits / titleToks.length : 0;
    const blobScore = blob.length ? blobHits / Math.min(blob.length, 10) : 0;
    const score = titleScore * 0.7 + blobScore * 0.3 + (titleHits >= 2 ? 0.25 : 0);
    if (score > best) {
      second = best;
      best = score;
      bestCode = normalizeIssueCode(issue.code);
    } else if (score > second) {
      second = score;
    }
  }
  if (best < 0.48) return "";
  if (best - second < 0.12) return "";
  return bestCode;
}

export type LlmDsrDraft = {
  customer?: string;
  wo?: string;
  location?: string;
  technician?: string;
  jobTask?: string;
  timeOn?: string;
  timeOff?: string;
  mileage?: string;
  estimatedCost?: string;
  materialUsed?: string;
  partsNeededText?: string;
  comments?: string;
  reportNo?: string;
  workDate?: string;
  crewToday?: string[];
  entries?: {
    time?: string;
    endTime?: string;
    text?: string;
    cxalloy?: string;
    workers?: string[];
    kind?: string;
    closed?: boolean;
  }[];
};

const CODE_IN_TEXT = /\b(?:CHK|FO)[-\s]?\d+(?:-\d+)?\b/i;

export function shouldRefineDsr(parsed: ParsedDsr, text: string, catalog: IssueHint[] = []) {
  const body = String(text || "");
  if (body.replace(/\s+/g, "").length < 80) return false;
  if ((parsed.entries || []).length < 2) return true;
  if (!validWorkOrder(parsed.wo) || !String(parsed.customer || "").trim()) return true;
  if (!String(parsed.technician || "").trim()) return true;
  const hay = body + " " + (parsed.entries || []).map((e) => e.text).join(" ");
  if (CODE_IN_TEXT.test(hay) && (parsed.entries || []).some((e) => e.text && !entryIssueCodes(e).length)) return true;
  if (catalog.length && (parsed.entries || []).some((e) => e.text && !entryIssueCodes(e).length)) return true;
  const thin = (parsed.entries || []).filter((e) => String(e.text || "").trim().length < 18).length;
  if (thin >= 2) return true;
  return false;
}

function fill(base: string, next: string, max: number) {
  if (String(base || "").trim()) return base;
  return cleanField(next || "", max);
}

function punchFromLlm(e: NonNullable<LlmDsrDraft["entries"]>[number]): TimelineEntry {
  const text = cleanField(e.text || "", 800);
  const cxalloy = normalizeIssueCode(e.cxalloy || "") || "";
  const workers = Array.isArray(e.workers) ? e.workers.map((w) => cleanField(String(w), 80)).filter(Boolean) : [];
  const closed = Boolean(e.closed) || entryMarksIssueClosed({ closed: false, text, cxalloy });
  return emptyPunch({
    time: normalizeHhmm(String(e.time || ""), ""),
    endTime: normalizeHhmm(String(e.endTime || ""), ""),
    text,
    cxalloy,
    workers,
    kind: e.kind === "standby" ? "standby" : "work",
    closed,
  });
}

function codeAllowed(code: string, catalog: Set<string>, haystack: string) {
  const c = normalizeIssueCode(code);
  if (!c || !/^(CHK|FO)-/i.test(c)) return "";
  const hay = haystack.toUpperCase();
  const mentioned = hay.includes(c.toUpperCase()) || hay.includes(c.replace(/-/g, "").toUpperCase());
  if (catalog.size) {
    if (catalog.has(c) && mentioned) return c;
    if (catalog.has(c) && !mentioned) return "";
  }
  return mentioned ? c : "";
}

function codesInText(s: string) {
  return [...String(s || "").matchAll(/\b((?:CHK|FO)[-\s]?\d+(?:-\d+)?)\b/gi)].map((m) =>
    normalizeIssueCode(m[1]),
  );
}

function pickCode(
  base: TimelineEntry,
  llm: TimelineEntry | undefined,
  hints: IssueHint[],
  hay: string,
) {
  if (base.cxalloy) return base.cxalloy;
  const catalog = new Set(hints.map((i) => normalizeIssueCode(i.code)).filter(Boolean));
  const mentioned = codesInText(hay).find((c) => codeAllowed(c, catalog, hay));
  if (mentioned) return mentioned;
  const fromDesc = matchIssueFromCatalog(hay, hints);
  if (fromDesc) return fromDesc;
  const llmCode = codeAllowed(llm?.cxalloy || "", catalog, hay) || "";
  if (llmCode) return llmCode;
  const assigned = normalizeIssueCode(llm?.cxalloy || "");
  if (assigned && catalog.has(assigned) && matchIssueFromCatalog(hay, hints) === assigned) {
    return assigned;
  }
  if (assigned && catalog.has(assigned)) {
    const issue = hints.find((h) => normalizeIssueCode(h.code) === assigned);
    if (issue && tokens(issue.title).filter((t) => tokens(hay).includes(t)).length >= 2) return assigned;
  }
  return "";
}

function pickCodes(
  base: TimelineEntry,
  llm: TimelineEntry | undefined,
  hints: IssueHint[],
  hay: string,
) {
  const fromBase = entryIssueCodes(base);
  const mentioned = [...new Set(codesInText(hay))];
  const fromLlm = entryIssueCodes(llm || {});
  const catalog = new Set(hints.map((i) => normalizeIssueCode(i.code)).filter(Boolean));
  const allowed = [...fromBase, ...mentioned, ...fromLlm].filter(
    (c) => fromBase.includes(c) || codeAllowed(c, catalog, hay),
  );
  const stamped = stampIssueCodes(allowed);
  if (stamped.cxalloys.length) return stamped;
  const one = pickCode(base, llm, hints, hay);
  return stampIssueCodes(one);
}

function mergeOneEntry(base: TimelineEntry, llm: TimelineEntry | undefined, hints: IssueHint[]) {
  const hay = llm ? `${base.text} ${llm.text}` : base.text;
  const stamped = pickCodes(base, llm, hints, hay);
  if (!llm) {
    const closed = base.closed || entryMarksIssueClosed({ text: base.text, ...stamped });
    return { ...base, ...stamped, closed, closedCodes: closed ? stamped.cxalloys : [] };
  }
  const baseThin = String(base.text || "").trim().length < 18;
  const text = baseThin && llm.text && llm.text.length > base.text.length ? llm.text : base.text;
  const workers = base.workers.length ? base.workers : llm.workers;
  const kind: TimelineEntry["kind"] =
    base.kind === "standby" || llm.kind === "standby" ? "standby" : "work";
  const closed = base.closed || llm.closed || entryMarksIssueClosed({ text, ...stamped });
  return {
    ...base,
    text,
    ...stamped,
    workers,
    kind,
    closed,
    closedCodes: closed ? stamped.cxalloys : [],
    endTime: base.endTime || llm.endTime,
  };
}

export function mergeRefinedDsr(base: ParsedDsr, llm: LlmDsrDraft, catalog: IssueHint[] = []): ParsedDsr {
  const wo = validWorkOrder(base.wo) || validWorkOrder(String(llm.wo || "")) || base.wo;
  const dateLocked = /^\d{4}-\d{2}-\d{2}$/.test(base.workDate);
  const llmEntries = (llm.entries || []).map(punchFromLlm).filter((e) => e.time || e.text);
  let entries = base.entries || [];
  if (entries.length < 2 && llmEntries.length >= 2) {
    entries = llmEntries.map((e) => mergeOneEntry(emptyPunch({ time: e.time, text: "" }), e, catalog));
  } else if (llmEntries.length) {
    const byTime = new Map<string, TimelineEntry>();
    for (const e of llmEntries) {
      const t = normalizeHhmm(e.time, "");
      if (t) byTime.set(t, e);
    }
    const used = new Set<string>();
    entries = entries.map((b) => {
      const t = normalizeHhmm(b.time, "");
      const hit = t ? byTime.get(t) : undefined;
      if (t && hit) used.add(t);
      return mergeOneEntry(b, hit, catalog);
    });
    for (const e of llmEntries) {
      const t = normalizeHhmm(e.time, "");
      if (t && !used.has(t) && (e.text || e.cxalloy)) entries.push(mergeOneEntry(e, undefined, catalog));
    }
  } else {
    entries = entries.map((b) => mergeOneEntry(b, undefined, catalog));
  }
  const crew = base.crewToday.length
    ? base.crewToday
    : (llm.crewToday || []).map((n) => cleanField(String(n), 80)).filter(Boolean);
  return {
    ...base,
    workDate: dateLocked ? base.workDate : base.workDate || String(llm.workDate || ""),
    reportNo: base.reportNo || String(llm.reportNo || "").replace(/[^\w]/g, ""),
    customer: fill(base.customer, llm.customer || "", 80),
    wo,
    location: fill(base.location, llm.location || "", 80),
    technician: fill(base.technician, llm.technician || "", 80),
    jobTask: fill(base.jobTask, llm.jobTask || "", 200),
    timeOn: base.timeOn || normalizeHhmm(String(llm.timeOn || ""), base.timeOn),
    timeOff: base.timeOff || normalizeHhmm(String(llm.timeOff || ""), base.timeOff),
    mileage: fill(base.mileage, llm.mileage || "", 20),
    estimatedCost: fill(base.estimatedCost, llm.estimatedCost || "", 20),
    materialUsed: fill(base.materialUsed, llm.materialUsed || "", 200),
    partsNeededText: fill(base.partsNeededText, llm.partsNeededText || "", 200),
    comments: fill(base.comments, llm.comments || "", 500),
    crewToday: crew,
    entries,
  };
}

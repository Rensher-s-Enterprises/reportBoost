import type { TimelineEntry } from "./types";
import { entryClosedCodes, entryIssueCodes, stampIssueCodes } from "./cxalloy.ts";
import { normalizeHhmm } from "../utils.ts";

export function hhmmToMin(t: string) {
  const d = normalizeHhmm(t, "0000");
  const h = Number(d.slice(0, 2));
  const m = Number(d.slice(2, 4));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

/** True when this punch should mark a CXAlloy code fixed — not "worksite closed". */
export function entryMarksIssueClosed(
  e: {
    closed?: boolean;
    text?: string;
    cxalloy?: string;
    cxalloys?: string[];
    closedCodes?: string[];
  },
  code?: string,
) {
  const target = String(code || "").trim();
  if (target) {
    const closed = entryClosedCodes(e);
    if (closed.includes(target)) return true;
    if (e.closed && !e.closedCodes?.length && entryIssueCodes(e).includes(target)) return true;
  } else if (e.closed || entryClosedCodes(e).length) {
    return true;
  }
  const codes = target ? [target] : entryIssueCodes(e);
  const t = String(e.text || "");
  if (!codes.length || !t) return false;
  if (/marked (this |the )?issue fixed|closed (the )?issue|completed work on/i.test(t)) return true;
  return codes.some((c) => {
    const esc = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`${esc}.{0,80}(was )?closed|closed.{0,40}${esc}`, "i").test(t);
  });
}

export function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
}

export function durationLabel(start: string, end: string) {
  if (!start || !end) return "";
  let d = hhmmToMin(end) - hhmmToMin(start);
  if (d < 0) d += 24 * 60;
  const h = Math.floor(d / 60);
  const m = d % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function minToHhmm(n: number) {
  const m = ((n % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}${String(mm).padStart(2, "0")}`;
}

function workersOverlap(a: string[], b: string[]) {
  if (!a.length || !b.length) return true;
  return a.some((w) => b.includes(w));
}

/** Keep simultaneous punches for different people; bump 1 minute if the same crew punches twice. */
export function nextFreeTime(entries: TimelineEntry[], desired: string, workers: string[]) {
  let t = hhmmToMin(desired || nowHHMM());
  const used = new Set(
    entries.filter((e) => workersOverlap(e.workers, workers)).map((e) => hhmmToMin(e.time)),
  );
  while (used.has(t)) t += 1;
  return minToHhmm(t);
}

export function minutesBetween(start: string, end: string) {
  if (!start || !end) return 0;
  let d = hhmmToMin(end) - hhmmToMin(start);
  if (d < 0) d += 24 * 60;
  return d;
}

/** When a worker punches in on a new task, their previous task ends. */
export function chainEntries(entries: TimelineEntry[], timeOff: string): TimelineEntry[] {
  const list = entries.map((e) => ({ ...e }));
  const endById = new Map<string, string>();
  const groups = new Map<string, TimelineEntry[]>();
  for (const e of list) {
    const keys = e.workers.length ? e.workers : ["*all*"];
    for (const k of keys) {
      const arr = groups.get(k) ?? [];
      arr.push(e);
      groups.set(k, arr);
    }
  }
  for (const punches of groups.values()) {
    punches.sort((a, b) => hhmmToMin(a.time) - hhmmToMin(b.time) || a.id.localeCompare(b.id));
    for (let i = 0; i < punches.length; i++) {
      const next = punches[i + 1];
      const end = next?.time || timeOff;
      const prev = endById.get(punches[i].id);
      if (!prev || hhmmToMin(end) < hhmmToMin(prev)) endById.set(punches[i].id, end);
    }
  }
  return list
    .map((e) => ({ ...e, endTime: endById.get(e.id) || e.endTime || timeOff }))
    .sort((a, b) => hhmmToMin(a.time) - hhmmToMin(b.time) || a.id.localeCompare(b.id));
}

export function emptyPunch(partial: Partial<TimelineEntry> = {}): TimelineEntry {
  const stamped = stampIssueCodes([...(partial.cxalloys || []), partial.cxalloy || ""]);
  const closedCodes = entryClosedCodes({
    ...stamped,
    closed: partial.closed,
    closedCodes: partial.closedCodes,
  });
  return {
    id: crypto.randomUUID(),
    time: nowHHMM(),
    endTime: "",
    text: "",
    workers: [],
    kind: "work",
    standbyWhere: "",
    standbyReason: "",
    standbyNote: "",
    ...partial,
    ...stamped,
    closedCodes,
    closed: closedCodes.length > 0 || Boolean(partial.closed),
  };
}

export const STANDBY_REASONS = [
  { id: "worksite_closed", label: "Worksite closed" },
  { id: "no_access", label: "No access to equipment" },
  { id: "waiting_parts", label: "Waiting on parts / direction" },
  { id: "other", label: "Other" },
] as const;

import type { TimelineEntry } from "./types";
import { entryClosedCodes, entryIssueCodes } from "./cxalloy.ts";
import { durationLabel } from "./timeline.ts";

function hay(text: string) {
  return String(text || "").toLowerCase();
}

/** True if a crew name (or its first/last token) already appears in the punch. */
export function nameMentionedInText(name: string, text: string) {
  const h = hay(text);
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 1);
  if (!parts.length) return false;
  return parts.some((p) => h.includes(p.toLowerCase()));
}

function missingWorkers(workers: string[], text: string) {
  return (workers || []).filter((w) => w && !nameMentionedInText(w, text));
}

export function formatWorkPerformedLine(e: TimelineEntry) {
  const span = e.endTime && e.endTime !== e.time ? `${e.time}–${e.endTime}` : e.time || "";
  const dur = durationLabel(e.time, e.endTime);
  const text = String(e.text || "").trim();
  const h = hay(text);
  const standby = e.kind === "standby" && !/\bstandby\b/i.test(text) ? "STANDBY — " : "";
  const missingCodes = entryIssueCodes(e).filter((c) => !h.includes(c.toLowerCase()));
  const cx = missingCodes.length ? ` (${missingCodes.join(", ")})` : "";
  const who = missingWorkers(e.workers || [], text);
  const whoBit = who.length ? ` [${who.join(", ")}]` : "";
  const closed =
    entryClosedCodes(e).length && !/\b(closed|fixed|marked .{0,24}complete)/i.test(text)
      ? " Closed."
      : "";
  return `${span}${dur ? ` (${dur})` : ""}${span ? ": " : ""}${standby}${text}${cx}${whoBit}${closed}`;
}

import type { Issue, TimelineEntry } from "./types";
import { entryClosedCodes, entryIssueCodes } from "./cxalloy.ts";

type IssueBit = Pick<Issue, "code" | "title" | "description" | "status">;

function whoPhrase(workers: string[], crew: string[]) {
  const names = (workers.length ? workers : crew).filter(Boolean);
  if (!names.length) return "We";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function softenCaps(s: string) {
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length < 10) return s;
  const upper = (s.match(/[A-Z]/g) || []).length;
  if (upper / letters.length < 0.72) return s;
  return s.replace(/[A-Z]{2,}/g, (w) => {
    if (/^(CHK|FO|MDC|PMDC|SDC|JSA|N\/A|LV|UT|ERMS)$/.test(w)) return w;
    return w.charAt(0) + w.slice(1).toLowerCase();
  });
}

function tidy(s: string) {
  let t = String(s || "").replace(/\s+/g, " ").trim();
  t = softenCaps(t);
  if (t && !/[.!?]$/.test(t)) t += ".";
  return t;
}

function shortDesc(desc: string) {
  const t = String(desc || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const cut = t.slice(0, 160);
  const stop = cut.lastIndexOf(".");
  return (stop > 40 ? cut.slice(0, stop + 1) : cut).trim();
}

export function fleshOutDay(input: {
  entries: TimelineEntry[];
  issues: IssueBit[];
  comments: string;
  crew: string[];
  jobTask?: string;
}) {
  const byCode = new Map(input.issues.map((i) => [i.code, i]));
  const crew = input.crew.filter(Boolean);
  const entries = input.entries.map((e) => {
    const codes = entryIssueCodes(e);
    const closedCodes = entryClosedCodes(e);
    const issue = codes[0] ? byCode.get(codes[0]) : undefined;
    const who = whoPhrase(e.workers, crew);
    let text = tidy(e.text);

    if (e.kind === "standby") {
      if (text.length < 12) {
        const where = e.standbyWhere === "hotel" ? "at the hotel" : "on site";
        const why = e.standbyNote || e.standbyReason?.replace(/_/g, " ") || "waiting on direction";
        text = `${who} remained ${where} on standby because ${why}.`;
      }
      return { id: e.id, text };
    }

    if (codes.length) {
      const list = codes.join(", ");
      const hay = text.toLowerCase();
      const missing = codes.filter((c) => !hay.includes(c.toLowerCase()));
      const thin =
        !text ||
        text.length < 24 ||
        /^(closed|fixed|done|complete[d]?)\.?$/i.test(text) ||
        codes.some((c) => new RegExp(`^${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?$`, "i").test(text));

      if (thin) {
        if (closedCodes.length && closedCodes.length === codes.length) {
          if (codes.length === 1) {
            const work =
              issue && issue.title && issue.title !== issue.code ? issue.title : list;
            text = `${who} closed ${list} after finishing ${work}.`;
          } else {
            text = `${who} closed ${list}.`;
          }
        } else if (closedCodes.length) {
          text = `${who} worked ${list} and closed ${closedCodes.join(", ")}.`;
        } else if (codes.length === 1) {
          const title = issue && issue.title && issue.title !== issue.code ? issue.title : "";
          const desc = issue ? shortDesc(issue.description) : "";
          const work = title || desc || list;
          text = `${who} worked ${work} (${list}).`;
        } else {
          text = `${who} worked ${list}.`;
        }
        text = tidy(text);
      } else {
        if (missing.length) {
          text = `${text.replace(/[.!?]$/, "")} (${missing.join(", ")}).`;
        }
        if (closedCodes.length && !/\b(closed|fixed|completed)\b/i.test(text)) {
          text = `${text.replace(/[.!?]$/, "")} Closed ${closedCodes.join(", ")}.`;
        }
      }
    } else if (text && text.length < 18) {
      text = tidy(`${who} ${text.charAt(0).toLowerCase()}${text.slice(1)}`);
    }

    return { id: e.id, text };
  });

  let comments = String(input.comments || "").replace(/\s+/g, " ").trim();
  if (!comments || /^work day\.?$/i.test(comments)) {
    const closed = input.entries.flatMap((e) => entryClosedCodes(e));
    const uniq = [...new Set(closed)];
    const crewBit = crew.length ? ` Crew on site: ${crew.join(", ")}.` : "";
    const closeBit = uniq.length ? ` Closed ${uniq.join(", ")}.` : "";
    comments = tidy(`${input.jobTask ? `${input.jobTask}.` : "Work day."}${crewBit}${closeBit}`);
  }

  return { comments, entries };
}

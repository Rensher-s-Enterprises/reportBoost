import type { Report } from "./types";

const key = (id: string) => `dsr.reportDraft.${id}`;

type Disk = { report: Report; synced: boolean; at: number };

function read(id: string): Disk | null {
  try {
    const raw = localStorage.getItem(key(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Disk;
    if (!parsed?.report?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeReportDraft(report: Report, synced: boolean) {
  try {
    const disk: Disk = { report, synced, at: Date.now() };
    localStorage.setItem(key(report.id), JSON.stringify(disk));
  } catch {
    /* quota / private mode */
  }
}

export function readUnsyncedDraft(id: string): Report | null {
  const disk = read(id);
  if (!disk || disk.synced) return null;
  return disk.report;
}

export function clearReportDraft(id: string) {
  try {
    localStorage.removeItem(key(id));
  } catch {
    /* ignore */
  }
}

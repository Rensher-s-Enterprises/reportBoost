import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid() {
  return crypto.randomUUID();
}

export function todayISO() {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

/** Accept 7, 7:00, 700, 07:00, 0730 → HHMM. */
export function normalizeHhmm(raw: string, fallback = ""): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return fallback;
  let h = 0;
  let m = 0;
  if (digits.length === 1) {
    h = Number(digits);
  } else if (digits.length === 2) {
    const n = Number(digits);
    if (n <= 23) h = n;
    else {
      h = Number(digits[0]);
      m = Number(digits.slice(1).padEnd(2, "0"));
    }
  } else if (digits.length === 3) {
    h = Number(digits[0]);
    m = Number(digits.slice(1));
  } else {
    h = Number(digits.slice(0, 2));
    m = Number(digits.slice(2, 4));
  }
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback;
  if (h > 23) h = 23;
  if (m > 59) m = 59;
  return `${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}`;
}

export function isUnauthorized(err: unknown) {
  if (!err || typeof err !== "object") return false;
  const e = err as { message?: string; name?: string; status?: number };
  return e.message === "Unauthorized" || e.name === "UnauthorizedError" || e.status === 401;
}

export function fmtDateDots(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${m}.${d}.${y}`;
}

export function peekWorkDate(filename: string) {
  const base = String(filename || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.pdf$/i, "") || "";
  const dotted = base.match(/(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?!\d)/);
  if (dotted) {
    const month = dotted[1].padStart(2, "0");
    const day = dotted[2].padStart(2, "0");
    let year = dotted[3];
    if (year.length === 2) year = `20${year}`;
    const y = Number(year);
    if (y >= 2020 && y <= 2035 && Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
      return `${year}-${month}-${day}`;
    }
  }
  const compact = base.match(/(?<!\d)(\d{2})(\d{2})(\d{2})[A-Za-z]{2,4}(?![A-Za-z])/);
  if (compact) return `20${compact[3]}-${compact[1]}-${compact[2]}`;
  const tail = base.match(/(?<!\d)(\d{2})(\d{2})(\d{2})$/);
  if (tail) return `20${tail[3]}-${tail[1]}-${tail[2]}`;
  return "";
}

export function initialsFromName(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter((p) => /[A-Za-z]/.test(p));
  if (!parts.length) return "";
  return parts
    .map((p) => p[0])
    .join("")
    .slice(0, 4)
    .toUpperCase();
}

export function makeReportNo(iso: string, initials: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${m}${d}${y.slice(2)}${(initials || "XXX").toUpperCase()}`;
}

export function niceDate(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function namesFromCrew(crew: string) {
  return String(crew || "")
    .split(/[,;/]|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

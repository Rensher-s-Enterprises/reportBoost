import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import type { TimelineEntry } from "./types";
import { normalizeIssueCode, stampIssueCodes } from "./cxalloy.ts";

export type ParsedDsr = {
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
  customerSignName: string;
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

export type ExtractedPhoto = {
  mime: "image/jpeg";
  dataB64: string;
  bytes: number;
};

function nid() {
  return crypto.randomUUID();
}

function punch(partial: Partial<TimelineEntry>): TimelineEntry {
  return {
    id: nid(),
    time: "",
    endTime: "",
    text: "",
    cxalloy: "",
    cxalloys: [],
    workers: [],
    kind: "work",
    standbyWhere: "",
    standbyReason: "",
    standbyNote: "",
    closed: false,
    closedCodes: [],
    ...partial,
  };
}

function bytesToB64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function ascii85Decode(src: Uint8Array) {
  const s = new TextDecoder("latin1").decode(src).replace(/\s+/g, "");
  const out: number[] = [];
  let i = s.startsWith("<~") ? 2 : 0;
  while (i < s.length) {
    if (s[i] === "~") break;
    if (s[i] === "z") {
      out.push(0, 0, 0, 0);
      i += 1;
      continue;
    }
    const buf = [0, 0, 0, 0, 0];
    let count = 0;
    while (count < 5 && i < s.length && s[i] !== "~") {
      const c = s.charCodeAt(i) - 33;
      if (c < 0 || c > 84) {
        i += 1;
        continue;
      }
      buf[count] = c;
      count += 1;
      i += 1;
    }
    if (!count) break;
    for (let k = count; k < 5; k++) buf[k] = 84;
    let tuple = 0;
    for (let k = 0; k < 5; k++) tuple = tuple * 85 + buf[k];
    const bytes = [(tuple >>> 24) & 255, (tuple >>> 16) & 255, (tuple >>> 8) & 255, tuple & 255];
    out.push(...bytes.slice(0, Math.max(0, count - 1)));
  }
  return Uint8Array.from(out);
}

function num(v: unknown) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export async function extractDsrPhotos(bytes: Uint8Array): Promise<ExtractedPhoto[]> {
  const out: ExtractedPhoto[] = [];
  try {
    for await (const data of iterDsrJpegs(bytes, 24)) {
      out.push({ mime: "image/jpeg", dataB64: bytesToB64(data), bytes: data.length });
    }
  } catch {
    return out;
  }
  return out;
}

export async function* iterDsrJpegs(bytes: Uint8Array, max = 100): AsyncGenerator<Uint8Array> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const seen = new Set<string>();
  let n = 0;
  const pages = pdf.getPages();
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const res = page.node.Resources();
    if (!res) continue;
    const xo = res.lookup(PDFName.of("XObject")) as
      | { entries?: () => [unknown, unknown][] }
      | undefined;
    if (!xo?.entries) continue;
    for (const [, ref] of xo.entries()) {
      const stream = pdf.context.lookup(ref as never);
      if (!(stream instanceof PDFRawStream)) continue;
      const subtype = String(stream.dict.get(PDFName.of("Subtype")) || "");
      if (!subtype.includes("Image")) continue;
      const filter = String(stream.dict.get(PDFName.of("Filter")) || "");
      const w = num(stream.dict.get(PDFName.of("Width")));
      const h = num(stream.dict.get(PDFName.of("Height")));
      if (h < 200 || w < 240) continue;
      if (h <= 180 && w / Math.max(h, 1) > 2.2) continue;
      if (pageIndex === 0 && pages.length > 1 && h > 900 && w > 600) continue;
      let data = stream.contents;
      if (filter.includes("ASCII85")) {
        try {
          data = ascii85Decode(data);
        } catch {
          continue;
        }
      }
      if (!(data[0] === 0xff && data[1] === 0xd8)) continue;
      const key = `${w}x${h}:${data.length}:${data[10] ?? 0}:${data[40] ?? 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      yield data.slice();
      n += 1;
      if (n >= max) return;
    }
  }
}

function isJpegBytes(data: Uint8Array) {
  return data.length > 3 && data[0] === 0xff && data[1] === 0xd8;
}

function codesOnPage(text: string) {
  return [...String(text || "").matchAll(/\b((?:CHK|FO)[-\s]?\d+(?:-\d+)?)\b/gi)]
    .map((m) => normalizeIssueCode(m[1]))
    .filter(Boolean);
}

/** Photo pages in CXAlloy often omit the CHK code — inherit the last issue. */
export function assignPhotosToCodes(
  pages: { text: string; photos: ExtractedPhoto[] }[],
): { code: string; photos: ExtractedPhoto[] }[] {
  const byCode = new Map<string, ExtractedPhoto[]>();
  let last = "";
  for (const page of pages) {
    const codes = codesOnPage(page.text);
    if (codes[0]) last = codes[0];
    const code = codes[0] || last;
    if (!code || !page.photos.length) continue;
    const arr = byCode.get(code) ?? [];
    for (const ph of page.photos) {
      if (arr.some((p) => p.bytes === ph.bytes && p.dataB64.slice(0, 40) === ph.dataB64.slice(0, 40))) {
        continue;
      }
      arr.push(ph);
    }
    byCode.set(code, arr.slice(0, 8));
  }
  return [...byCode.entries()].map(([code, photos]) => ({ code, photos }));
}

async function inflatePdfFlate(data: Uint8Array) {
  const tryFmt = async (format: "deflate" | "deflate-raw") => {
    const ds = new DecompressionStream(format);
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };
  try {
    return await tryFmt("deflate");
  } catch {
    return tryFmt("deflate-raw");
  }
}

async function flateRgbToJpeg(data: Uint8Array, w: number, h: number, colorSpace: string) {
  if (typeof document === "undefined") return null;
  let rgb: Uint8Array;
  try {
    rgb = await inflatePdfFlate(data);
  } catch {
    return null;
  }
  const gray = /DeviceGray|Indexed/i.test(colorSpace);
  const need = gray ? w * h : w * h * 3;
  if (rgb.length < need) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  if (gray) {
    for (let i = 0, p = 0; i < w * h; i++) {
      const v = rgb[i];
      img.data[p++] = v;
      img.data[p++] = v;
      img.data[p++] = v;
      img.data[p++] = 255;
    }
  } else {
    for (let i = 0, p = 0; i < w * h; i++) {
      img.data[p++] = rgb[i * 3];
      img.data[p++] = rgb[i * 3 + 1];
      img.data[p++] = rgb[i * 3 + 2];
      img.data[p++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL("image/jpeg", 0.82);
  const comma = url.indexOf(",");
  const dataB64 = comma >= 0 ? url.slice(comma + 1) : url;
  return { mime: "image/jpeg" as const, dataB64, bytes: Math.round((dataB64.length * 3) / 4) };
}

async function imagesOnPage(
  pdf: PDFDocument,
  pageIndex: number,
  minW: number,
  minH: number,
): Promise<ExtractedPhoto[]> {
  const page = pdf.getPages()[pageIndex];
  if (!page) return [];
  const res = page.node.Resources();
  if (!res) return [];
  const xo = res.lookup(PDFName.of("XObject")) as { entries?: () => [unknown, unknown][] } | undefined;
  if (!xo?.entries) return [];
  const out: ExtractedPhoto[] = [];
  const seen = new Set<string>();
  for (const [, ref] of xo.entries()) {
    const stream = pdf.context.lookup(ref as never);
    if (!(stream instanceof PDFRawStream)) continue;
    const subtype = String(stream.dict.get(PDFName.of("Subtype")) || "");
    if (!subtype.includes("Image")) continue;
    const filter = String(stream.dict.get(PDFName.of("Filter")) || "");
    const cs = String(stream.dict.get(PDFName.of("ColorSpace")) || "");
    const w = num(stream.dict.get(PDFName.of("Width")));
    const h = num(stream.dict.get(PDFName.of("Height")));
    if (w < minW || h < minH) continue;
    let data = stream.contents;
    if (filter.includes("ASCII85")) {
      try {
        data = ascii85Decode(data);
      } catch {
        continue;
      }
    }
    let photo: ExtractedPhoto | null = null;
    if (isJpegBytes(data) || filter.includes("DCTDecode")) {
      if (!isJpegBytes(data)) continue;
      photo = { mime: "image/jpeg", dataB64: bytesToB64(data), bytes: data.length };
    } else if (filter.includes("Flate")) {
      photo = await flateRgbToJpeg(data, w, h, cs);
    }
    if (!photo) continue;
    const key = `${w}x${h}:${photo.bytes}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(photo);
  }
  return out;
}

export async function extractCxalloyIssuePhotos(bytes: Uint8Array) {
  const textBytes = bytes.slice();
  const pdfBytes = bytes.slice();
  const { extractText } = await import("unpdf");
  let pagesText: string[] = [];
  try {
    const extracted = await extractText(textBytes, { mergePages: false });
    const raw = extracted.text as unknown as string | string[];
    pagesText = Array.isArray(raw) ? raw.map(String) : [String(raw || "")];
  } catch {
    const extracted = await extractText(textBytes.slice(), { mergePages: true });
    const raw = extracted.text as unknown as string | string[];
    pagesText = [Array.isArray(raw) ? raw.join("\n") : String(raw || "")];
  }
  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const n = pdf.getPageCount();
  const pages: { text: string; photos: ExtractedPhoto[] }[] = [];
  for (let i = 0; i < n; i++) {
    pages.push({
      text: pagesText[i] || (i === 0 ? pagesText[0] || "" : ""),
      photos: await imagesOnPage(pdf, i, 160, 160),
    });
  }
  return assignPhotosToCodes(pages);
}

function pad4(t: string) {
  return t.replace(/\D/g, "").padStart(4, "0").slice(0, 4);
}

export function parseIsoDate(raw: string): string {
  const s = String(raw || "").trim();
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!m) return "";
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = m[3];
  if (year.length === 2) year = `20${year}`;
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const y = Number(year);
  if (y < 2020 || y > 2035) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function dateFromReportNo(no: string) {
  const m = String(no || "")
    .replace(/\s/g, "")
    .match(/(\d{2})(\d{2})(\d{2})[A-Za-z]{2,4}/);
  if (!m) return "";
  return parseIsoDate(`${m[1]}.${m[2]}.20${m[3]}`);
}

export function dateFromFilename(name: string) {
  const base = String(name || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.pdf$/i, "") || "";
  const dotted = base.match(/(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?!\d)/);
  if (dotted) {
    const iso = parseIsoDate(`${dotted[1]}.${dotted[2]}.${dotted[3]}`);
    if (iso) return iso;
  }
  const compact = base.match(/(?<!\d)(\d{2})(\d{2})(\d{2})[A-Za-z]{2,4}(?![A-Za-z])/);
  if (compact) {
    const iso = parseIsoDate(`${compact[1]}.${compact[2]}.20${compact[3]}`);
    if (iso) return iso;
  }
  const tail = base.match(/(?<!\d)(\d{2})(\d{2})(\d{2})$/);
  if (tail) {
    const iso = parseIsoDate(`${tail[1]}.${tail[2]}.20${tail[3]}`);
    if (iso) return iso;
  }
  return "";
}

function reportNosInText(text: string) {
  return [...String(text || "").matchAll(/\bNo\.?:\s*(\d{6}[A-Za-z]{2,4})\b/gi)].map((m) =>
    m[1].toUpperCase(),
  );
}

function mostCommon(values: string[]) {
  const c = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    c.set(v, (c.get(v) || 0) + 1);
  }
  let best = "";
  let n = 0;
  for (const [v, k] of c) {
    if (k > n) {
      best = v;
      n = k;
    }
  }
  return best;
}

function extractFormDate(text: string) {
  const head = String(text || "").slice(0, 2000);
  const re = /Date\s*:\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})/gi;
  for (const m of head.matchAll(re)) {
    const before = head.slice(Math.max(0, (m.index || 0) - 48), m.index);
    if (/prints|job\s*#|job number|&\s*date/i.test(before)) continue;
    const iso = parseIsoDate(m[1]);
    if (iso) return iso;
  }
  return "";
}

export type DateOption = { iso: string; label: string };

export type DateSignals = {
  fileDate: string;
  headerDate: string;
  reportNoDate: string;
  options: DateOption[];
  conflict: boolean;
};

export function collectDateSignals(text: string, filename = "", reportNo = ""): DateSignals {
  const fileDate = dateFromFilename(filename);
  const headerDate = extractFormDate(text);
  const nos = reportNosInText(text);
  const reportNoDate =
    dateFromReportNo(reportNo) || mostCommon(nos.map(dateFromReportNo).filter(Boolean));
  const options: DateOption[] = [];
  const add = (iso: string, label: string) => {
    if (!iso || options.some((o) => o.iso === iso)) return;
    options.push({ iso, label });
  };
  add(fileDate, "Date in the file name");
  add(headerDate, "Date on the form");
  add(reportNoDate, "Date in the report number");
  const contentDiffers = [headerDate, reportNoDate].some((d) => d && d !== fileDate);
  const conflict = Boolean(fileDate && contentDiffers);
  return { fileDate, headerDate, reportNoDate, options, conflict };
}

export function resolveWorkDate(text: string, filename = "", reportNo = "") {
  const s = collectDateSignals(text, filename, reportNo);
  if (s.conflict) return "";
  return s.fileDate || s.reportNoDate || s.headerDate || "";
}

function looksGarbage(s: string) {
  const t = String(s || "");
  if (t.length > 120 && t.split(/\s+/).length < 4) return true;
  const weird = (t.match(/[^\p{L}\p{N} .,:;()[\]\-/#']/gu) || []).length;
  return t.length > 40 && weird / t.length > 0.22;
}

export function cleanField(raw: string, max = 280) {
  const s = String(raw || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || looksGarbage(s)) return "";
  return s.slice(0, max);
}

export function cleanReportNo(raw: string) {
  const m = String(raw || "").match(/\d{6}[A-Za-z]{2,4}/);
  return m ? m[0].toUpperCase() : "";
}

function extractReportNo(text: string, filename = "") {
  const nos = reportNosInText(text);
  const fileDate = dateFromFilename(filename);
  if (fileDate) {
    const match = nos.find((n) => dateFromReportNo(n) === fileDate);
    if (match) return match;
  }
  const common = mostCommon(nos);
  if (common) return common;
  const fromName = cleanReportNo(filename);
  if (fromName) return fromName;
  return cleanReportNo(grab(text, "No\\.", []) || text.match(/No\.:\s*(\S+)/i)?.[1] || "");
}

const FORM_CHROME =
  /^(name(\/employee.*)?|employee id|job task|job complete|work performed|charge code|customer|location|date|technician|comments|material used|parts needed|drawings needed|return call|rental equipment|type of transportation|generator size|prints or job)\b/i;

export function looksLikeFormChrome(value: string) {
  const t = String(value || "").replace(/\s+/g, " ").trim();
  if (!t) return true;
  if (/^n\/?a$/i.test(t)) return false;
  if (FORM_CHROME.test(t)) return true;
  if (/name\/employee/i.test(t)) return true;
  return false;
}

export function validWorkOrder(raw: string) {
  const t = String(raw || "").replace(/[^\d]/g, "");
  return /^\d{4,8}$/.test(t) ? t : "";
}

export function jobFromFilename(name: string) {
  const base =
    String(name || "")
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      ?.replace(/\.pdf$/i, "") || "";
  const wo = validWorkOrder(base.match(/WO[#_:\s-]*(\d{4,8})/i)?.[1] || "");
  let customer = "";
  const dsr = base.match(/^DSR[_\s-]+(.+?)[_\s-]+\d{6}/i);
  if (dsr) customer = dsr[1].replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (looksLikeFormChrome(customer)) customer = "";
  return { wo, customer };
}

function headerBlock(text: string) {
  const t = String(text || "");
  const cut = t.search(/Work Performed\s*:/i);
  if (cut >= 0) return t.slice(0, cut);
  const job = t.search(/Job Task\s*:/i);
  if (job > 40) return t.slice(0, job);
  return t.slice(0, 1600);
}

function grabLine(text: string, label: string, until: string[]) {
  const start = new RegExp(`${label}[ \\t]*:[ \\t]*`, "i");
  const m = start.exec(text);
  if (!m || m.index == null) return "";
  const rest = text.slice(m.index + m[0].length);
  const line = rest.split(/\r?\n/, 1)[0] || "";
  if (!until.length) return line.replace(/\s+/g, " ").trim();
  const untilRe = new RegExp(`(?:^|\\s)(?:${until.join("|")})\\b`, "i");
  const end = line.search(untilRe);
  return (end >= 0 ? line.slice(0, end) : line).replace(/\s+/g, " ").trim();
}

function grab(text: string, label: string, until: string[]) {
  return grabLine(text, label, until);
}

function grabMultiline(text: string, label: string, until: string[]) {
  const start = new RegExp(`${label}[ \\t]*:[ \\t]*`, "i");
  const m = start.exec(text);
  if (!m || m.index == null) return "";
  const rest = text.slice(m.index + m[0].length);
  const untilRe = until.length
    ? new RegExp(`(?:^|\\n)\\s*(?:${until.join("|")})\\b`, "i")
    : /$/;
  const end = rest.search(untilRe);
  const block = (end >= 0 ? rest.slice(0, end) : rest.split(/\r?\n/).slice(0, 4).join(" "));
  return block.replace(/\s+/g, " ").trim();
}

function usable(value: string, max = 280) {
  const cleaned = cleanField(value, max);
  if (!cleaned || looksLikeFormChrome(cleaned)) return "";
  return cleaned;
}

function customerFromBody(text: string) {
  const m = String(text || "").match(
    /\b([A-Z]{2,8})\s*\(\s*([A-Za-z][A-Za-z0-9 ./-]*\s+[A-Za-z0-9 ./-]{1,40})\s*\)/,
  );
  if (!m) return "";
  return usable(`${m[1]} (${m[2].replace(/\s+/g, " ").trim()})`, 80);
}

function extraCrewNames(text: string, technician: string) {
  const idx = text.search(/Technician[ \t]*:/i);
  const window =
    idx >= 0 ? text.slice(Math.max(0, idx - 500), idx + 420) : text.slice(-900);
  const skip = technician.trim().toLowerCase();
  const names: string[] = [];
  for (const raw of window.split(/\n+/)) {
    const n = raw
      .replace(/\s*\/\s*\d+.*$/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!n || n.length > 42) continue;
    if (!/^\p{Lu}\p{L}+(?:\s+\p{Lu}\p{L}+){1,3}$/u.test(n)) continue;
    if (n.toLowerCase() === skip) continue;
    if (looksLikeFormChrome(n)) continue;
    if (!names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n);
  }
  return names;
}

function sliceBetween(text: string, start: string, end: string) {
  const si = text.search(new RegExp(start, "i"));
  if (si < 0) return "";
  const after = text.slice(si + start.length);
  const ei = after.search(new RegExp(end, "i"));
  return (ei >= 0 ? after.slice(0, ei) : after).trim();
}

function normalizeCx(raw: string) {
  return raw
    .replace(/\s+/g, "")
    .replace(/^(FO)(\d)/i, "FO-$2")
    .replace(/^(CHK)(\d)/i, "CHK-$2")
    .toUpperCase();
}

function extractCx(text: string) {
  return extractAllCx(text)[0] || "";
}

function extractAllCx(text: string) {
  const out: string[] = [];
  const re = /\b((?:CHK|FO)[-\s]?\d+(?:-\d+)?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const c = normalizeIssueCode(normalizeCx(m[1]));
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

function extractBracketWorkers(text: string) {
  const m = text.match(/\[([^\]]+)\]\s*$/);
  if (!m) return { text, workers: [] as string[] };
  const workers = m[1]
    .split(/,|\/|;|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
  return { text: text.slice(0, m.index).trim(), workers };
}

const SKIP_LINE =
  /^(DAILY SERVICE REPORT|MISSIONCRITICALGROUP\.COM|ALL WORK PERFORMED|PROCEDURES|\*NOTE|Name\/Employee ID|Name)$/i;

export function parseWorkPerformed(block: string): TimelineEntry[] {
  const lines = String(block || "")
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l && !SKIP_LINE.test(l));
  const entries: TimelineEntry[] = [];
  const timeRe =
    /^(\d{3,4})(?:\s*[–\-]\s*(\d{3,4}))?(?:\s*\(([^)]+)\))?\s*:?\s*(.*)$/;
  for (const line of lines) {
    const m = line.match(timeRe);
    if (m && Number(m[1].slice(0, 2)) <= 23) {
      let text = (m[4] || "").trim();
      const kind = /^STANDBY\b/i.test(text) || /\bstandby\b/i.test(text) ? "standby" : "work";
      text = text.replace(/^STANDBY\s*[—\-]+\s*/i, "").trim();
      const boxed = extractBracketWorkers(text);
      text = boxed.text;
      const codes = extractAllCx(text);
      if (codes.length === 1) {
        text = text
          .replace(/\(\s*((?:CHK|FO)[-\s]?\d+(?:-\d+)?)\s*\)/i, "")
          .replace(/\b((?:CHK|FO)[-\s]?\d+(?:-\d+)?)\b/i, "")
          .replace(/\s+/g, " ")
          .trim();
      }
      entries.push(
        punch({
          time: pad4(m[1]),
          endTime: m[2] ? pad4(m[2]) : "",
          text,
          ...stampIssueCodes(codes),
          workers: boxed.workers,
          kind,
          standbyWhere: kind === "standby" && /hotel/i.test(text) ? "hotel" : kind === "standby" ? "site" : "",
        }),
      );
    } else if (entries.length) {
      const last = entries[entries.length - 1];
      last.text = `${last.text} ${line}`.replace(/\s+/g, " ").trim();
      if (!last.cxalloy) {
        const extra = stampIssueCodes(extractAllCx(last.text));
        last.cxalloy = extra.cxalloy;
        last.cxalloys = extra.cxalloys;
      }
    }
  }
  return entries;
}

function crewFromComments(comments: string) {
  const m = comments.match(/Crew on site:\s*(.+?)(?:\.|$)/i);
  if (!m) return [];
  return m[1]
    .split(/,|\/|;|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseDsrText(text: string, filename = ""): ParsedDsr {
  const header = headerBlock(text);
  const named = jobFromFilename(filename);
  const reportNo = cleanReportNo(extractReportNo(text, filename) || filename);
  const workDate = resolveWorkDate(text, filename, reportNo);
  const timeOn = pad4(usable(grab(text, "Time On", ["Time Off", "Estimated Cost"]), 8) || "0700");
  const timeOff = pad4(usable(grab(text, "Time Off", ["Estimated Cost", "Mileage"]), 8) || "2000");
  const comments = usable(
    grab(text, "Comments", ["Job Complete", "ALL WORK"]).replace(/Name\/Employee ID.*$/i, ""),
    500,
  );
  const technician = usable(
    grab(text, "Technician", ["Customer", "Comments", "Name", "Name/Employee"]).replace(
      /\/\s*\d+.*/,
      "",
    ),
    80,
  );
  const work = sliceBetween(text, "Work Performed:", "Material Used:");
  const entries = parseWorkPerformed(work).filter((e) => !looksGarbage(e.text) && e.text.length < 600);
  const crewToday = [
    ...crewFromComments(comments),
    ...extraCrewNames(text, technician),
  ]
    .map((n) => usable(n, 40))
    .filter(Boolean)
    .filter((n, i, all) => all.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i);

  const customer =
    usable(grab(header, "Customer", ["Charge Code", "Location", "WO", "Job Task", "Work Performed"]), 80) ||
    named.customer ||
    customerFromBody(header);

  const wo =
    validWorkOrder(grab(header, "WO", ["P\\.O", "Customer", "Charge", "Location", "Date"])) ||
    named.wo ||
    validWorkOrder(text.match(/\bWO[#:\s-]*(\d{4,8})\b/i)?.[1] || "");

  const location = usable(
    grab(header, "Location", ["Type of Transportation", "Generator", "Customer", "Job Task", "Charge"]),
    80,
  );
  const jobTask = usable(
    grabMultiline(text, "Job Task", ["Work Performed", "Material Used"]),
    240,
  );

  return {
    workDate,
    reportNo,
    timeOn: timeOn === "0000" ? "0700" : timeOn,
    timeOff: timeOff === "0000" ? "2000" : timeOff,
    mileage: usable(grab(text, "Mileage Total \\(Round Trip\\)", ["Technician", "Comments"]), 24) || "N/A",
    estimatedCost: usable(grab(text, "Estimated Cost", ["Mileage Total", "Technician", "Comments"]), 24) || "N/A",
    materialUsed: usable(grab(text, "Material Used", ["Parts Needed"]), 200) || "N/A",
    partsNeededText: usable(grab(text, "Parts Needed/Delivery Required", ["Time On"]), 200),
    comments,
    technician,
    customerSignName: "",
    entries,
    crewToday,
    customer,
    wo,
    location,
    po: usable(grab(header, "P\\.O\\. Number", ["Customer", "Charge", "Location"]), 40),
    chargeCode: usable(grab(header, "Charge Code", ["Location", "Type of Transportation", "Job Task"]), 40),
    transportation: usable(grab(header, "Type of Transportation", ["Generator Size", "Qty", "Job Task"]), 80),
    generatorSize: usable(grab(header, "Generator Size", ["Qty", "Operating"]), 24),
    qty: usable(grab(header, "Qty", ["Operating Voltage", "DC Voltage"]), 16),
    operatingVoltage: usable(grab(header, "Operating Voltage", ["DC Voltage", "Switchgear"]), 24),
    dcVoltage: usable(grab(header, "DC Voltage", ["Switchgear", "Prints"]), 24),
    switchgearMfr: usable(
      grab(header, "Switchgear Manufacturer", ["Prints or Job", "Prints", "Job Task"]),
      80,
    ),
    prints: usable(grab(header, "Prints or Job[^:]*", ["Job Task", "Work Performed"]), 80),
    jobTask,
  };
}

export function looksLikeCxalloyList(text: string) {
  if (/DAILY SERVICE REPORT/i.test(text)) return false;
  const hits = text.match(/\b(?:CHK|FO)-\d+/gi) || [];
  return hits.length >= 5 && /construction issues/i.test(text);
}

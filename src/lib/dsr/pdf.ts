import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { fmtDateDots } from "@/lib/utils";
import type { Photo, Project, Report, TechProfile } from "./types";
import { photoPdfCaption } from "./cxalloy";
import { chainEntries } from "./timeline";
import { formatWorkPerformedLine } from "./work-line";
import { pdfSafeText } from "./pdf-text";

const FONT_EMBED = {
  subset: false,
  features: { liga: false, dlig: false, clig: false, calt: false, hlig: false, rlig: false },
} as const;

const NAVY = rgb(0.106, 0.212, 0.365);
const BLACK = rgb(0.05, 0.07, 0.1);
const WHITE = rgb(1, 1, 1);

export type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };

let fontBytes: { reg: ArrayBuffer; bold: ArrayBuffer; ital: ArrayBuffer } | null = null;
let logoBytes: ArrayBuffer | null = null;

function isTtf(buf: ArrayBuffer) {
  const u = new Uint8Array(buf);
  return u.length > 100 && u[0] === 0x00 && u[1] === 0x01 && u[2] === 0x00 && u[3] === 0x00;
}

async function fetchFont(path: string) {
  const res = await fetch(path);
  const buf = await res.arrayBuffer();
  if (!res.ok || !isTtf(buf)) {
    throw new Error(`Could not load font ${path}. Re-export after the app finishes loading.`);
  }
  return buf;
}

export async function loadAssets() {
  if (!fontBytes) {
    const [reg, bold, ital] = await Promise.all([
      fetchFont("/fonts/Carlito-Regular.ttf"),
      fetchFont("/fonts/Carlito-Bold.ttf"),
      fetchFont("/fonts/Carlito-Italic.ttf"),
    ]);
    fontBytes = { reg, bold, ital };
  }
  if (!logoBytes) logoBytes = await fetch("/logo.png").then((r) => r.arrayBuffer());
  return { fontBytes, logoBytes };
}

export async function embedAppFonts(pdf: PDFDocument): Promise<Fonts> {
  const assets = await loadAssets();
  pdf.registerFontkit(fontkit);
  return {
    regular: await pdf.embedFont(assets.fontBytes!.reg, FONT_EMBED),
    bold: await pdf.embedFont(assets.fontBytes!.bold, FONT_EMBED),
    italic: await pdf.embedFont(assets.fontBytes!.ital, FONT_EMBED),
  };
}

function glyphWidth(font: PDFFont, text: string, size: number) {
  try {
    const w = font.widthOfTextAtSize(text, size);
    if (Number.isFinite(w) && w >= 0) return w;
  } catch {
    /* unencodable glyph */
  }
  return Math.max(1, text.length) * size * 0.5;
}

export function wrap(text: string, font: PDFFont, size: number, maxW: number) {
  const words = pdfSafeText(text)
    .split(/\s+/)
    .filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur) {
      lines.push(cur);
      cur = "";
    }
  };
  const takeChunk = (chunk: string) => {
    if (glyphWidth(font, chunk, size) <= maxW) {
      const trial = cur ? `${cur} ${chunk}` : chunk;
      if (glyphWidth(font, trial, size) <= maxW) {
        cur = trial;
        return;
      }
      flush();
      cur = chunk;
      return;
    }
    flush();
    let piece = "";
    for (const ch of chunk) {
      const trial = piece + ch;
      if (glyphWidth(font, trial, size) <= maxW) piece = trial;
      else {
        if (piece) lines.push(piece);
        piece = ch;
      }
    }
    cur = piece;
  };
  for (const w of words) takeChunk(w);
  flush();
  return lines.length ? lines : [""];
}

export function drawFooter(page: PDFPage, fonts: Fonts) {
  const { width } = page.getSize();
  const site = "MISSIONCRITICALGROUP.COM";
  const size = 8;
  const sw = fonts.bold.widthOfTextAtSize(site, size);
  const y = 22;
  const left = 40;
  const right = width - 40;
  const mid = width / 2;
  page.drawLine({
    start: { x: left, y },
    end: { x: mid - sw / 2 - 8, y },
    thickness: 1.1,
    color: NAVY,
  });
  page.drawLine({
    start: { x: mid + sw / 2 + 8, y },
    end: { x: right, y },
    thickness: 1.1,
    color: NAVY,
  });
  page.drawText(site, { x: mid - sw / 2, y: y - 2.5, size, font: fonts.bold, color: NAVY });
}

function fieldLine(
  page: PDFPage,
  fonts: Fonts,
  label: string,
  value: string,
  x: number,
  y: number,
  labelSize: number,
  valueW: number,
) {
  const lw = fonts.bold.widthOfTextAtSize(label, labelSize);
  page.drawText(label, { x, y, size: labelSize, font: fonts.bold, color: BLACK });
  const vx = x + lw + 6;
  page.drawText(pdfSafeText(value), {
    x: vx + 2,
    y,
    size: 10.5,
    font: fonts.italic,
    color: BLACK,
  });
  page.drawLine({
    start: { x: vx, y: y - 1.5 },
    end: { x: vx + valueW, y: y - 1.5 },
    thickness: 0.6,
    color: BLACK,
  });
}

function checkbox(
  page: PDFPage,
  x: number,
  y: number,
  checked: boolean,
  caption: string,
  fonts: Fonts,
) {
  page.drawRectangle({
    x,
    y: y - 1.5,
    width: 9,
    height: 9,
    borderWidth: 0.9,
    borderColor: BLACK,
    color: WHITE,
  });
  if (checked) {
    page.drawLine({
      start: { x: x + 1.6, y: y + 2.4 },
      end: { x: x + 3.8, y: y + 0.2 },
      thickness: 1.4,
      color: BLACK,
    });
    page.drawLine({
      start: { x: x + 3.8, y: y + 0.2 },
      end: { x: x + 7.6, y: y + 6.8 },
      thickness: 1.4,
      color: BLACK,
    });
  }
  page.drawText(caption, { x: x + 13, y, size: 9.5, font: fonts.bold, color: BLACK });
  return 13 + fonts.bold.widthOfTextAtSize(caption, 9.5);
}

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function embedPhoto(pdf: PDFDocument, photo: { dataB64: string; mime?: string }) {
  const bytes = b64ToBytes(photo.dataB64);
  try {
    return await pdf.embedJpg(bytes);
  } catch {
    try {
      return await pdf.embedPng(bytes);
    } catch {
      return null;
    }
  }
}

async function drawPhotoPage(
  pdf: PDFDocument,
  fonts: Fonts,
  logoImg: PDFImage,
  headerLine: string,
  photo: Photo,
) {
  const page = pdf.addPage([612, 792]);
  const { width, height } = page.getSize();
  const logoW = 133;
  const logoH = 46;
  page.drawImage(logoImg, {
    x: (width - logoW) / 2,
    y: height - 26 - logoH,
    width: logoW,
    height: logoH,
  });
  const title = "DAILY SERVICE REPORT";
  page.drawText(title, {
    x: (width - fonts.bold.widthOfTextAtSize(title, 11)) / 2,
    y: height - 81,
    size: 11,
    font: fonts.bold,
    color: BLACK,
  });
  page.drawText(headerLine, {
    x: (width - fonts.regular.widthOfTextAtSize(headerLine, 8.5)) / 2,
    y: height - 94,
    size: 8.5,
    font: fonts.regular,
    color: BLACK,
  });
  page.drawLine({
    start: { x: 40, y: height - 100 },
    end: { x: width - 40, y: height - 100 },
    thickness: 0.7,
    color: NAVY,
  });

  const img = await embedPhoto(pdf, photo);
  if (!img) return;
  const label = pdfSafeText(photoPdfCaption(photo.cxalloy, photo.caption));
  const tsize = 8.5;
  const lines = label ? wrap(label, fonts.italic, tsize, width - 80).slice(0, 1) : [];
  const lineH = 11;
  const blockH = lines.length * lineH;
  const top = height - 108;
  const bottom = lines.length ? 28 + blockH : 36;
  const maxW = width - 80;
  const maxH = top - bottom;
  const scale = Math.min(maxW / img.width, maxH / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  page.drawImage(img, {
    x: (width - dw) / 2,
    y: bottom + (maxH - dh) / 2,
    width: dw,
    height: dh,
  });
  if (lines.length) {
    let ty = 22 + blockH - lineH;
    for (const line of lines) {
      page.drawText(line, {
        x: 40,
        y: ty,
        size: tsize,
        font: fonts.italic,
        color: BLACK,
      });
      ty -= lineH;
    }
  }
  drawFooter(page, fonts);
}

async function drawWorkContinuation(
  pdf: PDFDocument,
  fonts: Fonts,
  logoImg: PDFImage,
  headerLine: string,
  lines: string[],
) {
  let rest = [...lines];
  while (rest.length) {
    const page = pdf.addPage([612, 792]);
    const { width, height } = page.getSize();
    const left = 40;
    const right = width - 40;
    const logoW = 133;
    const logoH = 46;
    page.drawImage(logoImg, {
      x: (width - logoW) / 2,
      y: height - 26 - logoH,
      width: logoW,
      height: logoH,
    });
    const title = "DAILY SERVICE REPORT — continued";
    page.drawText(title, {
      x: (width - fonts.bold.widthOfTextAtSize(title, 11)) / 2,
      y: height - 81,
      size: 11,
      font: fonts.bold,
      color: BLACK,
    });
    page.drawText(headerLine, {
      x: (width - fonts.regular.widthOfTextAtSize(headerLine, 8.5)) / 2,
      y: height - 94,
      size: 8.5,
      font: fonts.regular,
      color: BLACK,
    });
    page.drawLine({
      start: { x: 40, y: height - 100 },
      end: { x: width - 40, y: height - 100 },
      thickness: 0.7,
      color: NAVY,
    });
    page.drawText("Work Performed (continued):", {
      x: left,
      y: height - 118,
      size: 10,
      font: fonts.bold,
      color: BLACK,
    });
    let y = height - 134;
    const keep: string[] = [];
    for (const w of rest) {
      if (y < 48) {
        keep.push(w);
        continue;
      }
      const wrapped = wrap(w, fonts.italic, 8.7, right - left);
      for (const line of wrapped) {
        if (y < 48) {
          keep.push(line);
          continue;
        }
        page.drawText(line, { x: left, y, size: 8.7, font: fonts.italic, color: BLACK });
        page.drawLine({
          start: { x: left, y: y - 1.5 },
          end: { x: right, y: y - 1.5 },
          thickness: 0.45,
          color: BLACK,
        });
        y -= 11.4;
      }
    }
    drawFooter(page, fonts);
    rest = keep;
  }
}

export function pdfFilename(project: Project, report: Report) {
  const who = (project.customer || "DSR").replace(/[^\w]+/g, "_").slice(0, 28);
  return `DSR_${who}_${report.reportNo || report.workDate}.pdf`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export async function buildOfficialPdf(
  project: Project,
  report: Report,
  photos: Photo[],
  profile?: TechProfile | null,
) {
  const assets = await loadAssets();
  const pdf = await PDFDocument.create();
  const fonts = await embedAppFonts(pdf);
  const logoImg = await pdf.embedPng(assets.logoBytes!);

  const page = pdf.addPage([612, 792]);
  const { width, height } = page.getSize();
  const left = 40;
  const right = width - 40;
  const dateFmt = fmtDateDots(report.workDate);

  const logoW = 155;
  const logoH = 54;
  page.drawImage(logoImg, {
    x: (width - logoW) / 2,
    y: height - 28 - logoH,
    width: logoW,
    height: logoH,
  });
  const title = "DAILY SERVICE REPORT";
  page.drawText(title, {
    x: (width - fonts.bold.widthOfTextAtSize(title, 12)) / 2,
    y: height - 94,
    size: 12,
    font: fonts.bold,
    color: BLACK,
  });

  let y = height - 116;
  fieldLine(page, fonts, "Date:", dateFmt, left, y, 10, 82);
  fieldLine(page, fonts, "WO:", project.wo || "", 210, y, 10, 110);
  fieldLine(
    page,
    fonts,
    "P.O. Number:",
    project.po || "",
    360,
    y,
    10,
    right - 360 - fonts.bold.widthOfTextAtSize("P.O. Number:", 10) - 6,
  );

  y -= 22;
  fieldLine(page, fonts, "Customer:", project.customer || "", left, y, 10, 205);
  fieldLine(
    page,
    fonts,
    "Charge Code:",
    project.chargeCode || "",
    310,
    y,
    10,
    right - 310 - fonts.bold.widthOfTextAtSize("Charge Code:", 10) - 6,
  );

  y -= 22;
  fieldLine(page, fonts, "Location:", project.location || "", left, y, 10, 168);
  fieldLine(
    page,
    fonts,
    "Type of Transportation:",
    project.transportation || "",
    260,
    y,
    10,
    right - 260 - fonts.bold.widthOfTextAtSize("Type of Transportation:", 10) - 6,
  );

  y -= 22;
  fieldLine(page, fonts, "Generator Size:", project.generatorSize || "N/A", left, y, 10, 60);
  fieldLine(page, fonts, "Qty:", project.qty || "N/A", 175, y, 10, 50);
  fieldLine(page, fonts, "Operating Voltage:", project.operatingVoltage || "", 265, y, 10, 50);
  fieldLine(
    page,
    fonts,
    "DC Voltage:",
    project.dcVoltage || "",
    430,
    y,
    10,
    right - 430 - fonts.bold.widthOfTextAtSize("DC Voltage:", 10) - 6,
  );

  y -= 22;
  fieldLine(page, fonts, "Switchgear Manufacturer:", project.switchgearMfr || "", left, y, 10, 155);
  fieldLine(
    page,
    fonts,
    "Prints or Job # & Date:",
    project.prints || "",
    300,
    y,
    10,
    right - 300 - fonts.bold.widthOfTextAtSize("Prints or Job # & Date:", 10) - 6,
  );

  y -= 22;
  const jt = "Job Task:";
  page.drawText(jt, { x: left, y, size: 10, font: fonts.bold, color: BLACK });
  const task = project.jobTask || "";
  const taskX = left + fonts.bold.widthOfTextAtSize(jt, 10) + 8;
  const taskLines = wrap(task, fonts.italic, 10, right - taskX).slice(0, 3);
  page.drawText(taskLines[0] || "", { x: taskX, y, size: 10, font: fonts.italic, color: BLACK });
  page.drawLine({
    start: { x: left + fonts.bold.widthOfTextAtSize(jt, 10) + 6, y: y - 1.5 },
    end: { x: right, y: y - 1.5 },
    thickness: 0.6,
    color: BLACK,
  });
  for (let i = 1; i < taskLines.length; i++) {
    y -= 12;
    page.drawText(taskLines[i], { x: left, y, size: 10, font: fonts.italic, color: BLACK });
    page.drawLine({
      start: { x: left, y: y - 1.5 },
      end: { x: right, y: y - 1.5 },
      thickness: 0.6,
      color: BLACK,
    });
  }

  y -= 18;
  page.drawText("Work Performed:", { x: left, y, size: 10, font: fonts.bold, color: BLACK });
  y -= 13;

  const entries = chainEntries(
    (report.entries || []).filter((e) => e.time || e.text),
    report.timeOff || "",
  );
  const workLines = entries.map((e) => formatWorkPerformedLine(e));
  const usable = right - left;
  const leftoverWork: string[] = [];
  let overflow = false;
  for (const line of workLines) {
    const wrapped = wrap(line, fonts.italic, 8.7, usable);
    for (const w of wrapped) {
      if (overflow || y < 198) {
        leftoverWork.push(w);
        overflow = true;
        continue;
      }
      page.drawText(w, { x: left, y, size: 8.7, font: fonts.italic, color: BLACK });
      page.drawLine({
        start: { x: left, y: y - 1.5 },
        end: { x: right, y: y - 1.5 },
        thickness: 0.45,
        color: BLACK,
      });
      y -= 11.4;
    }
  }

  y = 184;
  fieldLine(page, fonts, "Material Used:", report.materialUsed || "N/A", left, y, 10, 100);
  y -= 20;
  fieldLine(
    page,
    fonts,
    "Parts Needed/Delivery Required:",
    report.partsNeededText || "",
    left,
    y,
    10,
    160,
  );
  y -= 22;
  fieldLine(page, fonts, "Time On:", report.timeOn || "", left, y, 10, 44);
  fieldLine(page, fonts, "Time Off:", report.timeOff || "", 148, y, 10, 44);
  fieldLine(page, fonts, "Estimated Cost:", report.estimatedCost || "N/A", 266, y, 10, 40);
  fieldLine(page, fonts, "Mileage Total (Round Trip):", report.mileage || "N/A", 385, y, 9, 70);

  y = 125;
  const techName = (profile?.fullName || project.technician || "").trim();
  const emp = (profile?.employeeNumber || "").trim();
  fieldLine(
    page,
    fonts,
    "Technician:",
    emp ? `${techName}  #${emp}` : techName,
    left,
    y,
    10,
    176,
  );
  fieldLine(
    page,
    fonts,
    "Customer:",
    report.customerSignName || "",
    292,
    y,
    10,
    right - 292 - fonts.bold.widthOfTextAtSize("Customer:", 10) - 6,
  );
  page.drawText("Name/Employee ID", {
    x: 118,
    y: y - 10,
    size: 7,
    font: fonts.regular,
    color: BLACK,
  });
  page.drawText("Name", { x: 430, y: y - 10, size: 7, font: fonts.regular, color: BLACK });

  y = 104;
  const cLabel = "Comments:";
  const cLabelW = fonts.bold.widthOfTextAtSize(cLabel, 10);
  page.drawText(cLabel, { x: left, y, size: 10, font: fonts.bold, color: BLACK });
  const commentLines = wrap(report.comments || "", fonts.italic, 10, right - left - cLabelW - 8).slice(
    0,
    2,
  );
  page.drawText(commentLines[0] || "", {
    x: left + cLabelW + 8,
    y,
    size: 10,
    font: fonts.italic,
    color: BLACK,
  });
  page.drawLine({
    start: { x: left + cLabelW + 6, y: y - 1.5 },
    end: { x: right, y: y - 1.5 },
    thickness: 0.6,
    color: BLACK,
  });
  if (commentLines[1]) {
    y = 94;
    page.drawText(commentLines[1], { x: left, y, size: 10, font: fonts.italic, color: BLACK });
    page.drawLine({
      start: { x: left, y: y - 1.5 },
      end: { x: right, y: y - 1.5 },
      thickness: 0.6,
      color: BLACK,
    });
  }

  y = 80;
  let x = left;
  x += checkbox(page, x, y, !!report.jobComplete, "Job Complete", fonts) + 14;
  x += checkbox(page, x, y, !!report.partsNeeded, "Parts Needed", fonts) + 14;
  x += checkbox(page, x, y, !!report.drawingsNeeded, "Drawings Needed", fonts) + 14;
  x += checkbox(page, x, y, !!report.returnCallNeeded, "Return Call Needed", fonts) + 14;
  checkbox(page, x, y, !!report.rentalNeeded, "Rental Equipment Needed", fonts);

  const q1 =
    "ALL WORK PERFORMED UNDER THIS D.S.R. HAS BEEN IN ACCORDANCE WITH MISSION CRITICAL GROUP QUALITY POLICY &";
  page.drawText(q1, {
    x: (width - fonts.bold.widthOfTextAtSize(q1, 7.2)) / 2,
    y: 69,
    size: 7.2,
    font: fonts.bold,
    color: BLACK,
  });
  page.drawText("PROCEDURES", {
    x: (width - fonts.bold.widthOfTextAtSize("PROCEDURES", 7.2)) / 2,
    y: 61,
    size: 7.2,
    font: fonts.bold,
    color: BLACK,
  });
  const note = "*NOTE: A separate report must be completed for each day worked by each technician.";
  page.drawText(note, {
    x: (width - fonts.bold.widthOfTextAtSize(note, 8)) / 2,
    y: 50,
    size: 8,
    font: fonts.bold,
    color: BLACK,
  });
  const no = `No.: ${report.reportNo || ""}`;
  page.drawText(no, {
    x: (width - fonts.regular.widthOfTextAtSize(no, 9.5)) / 2,
    y: 40,
    size: 9.5,
    font: fonts.regular,
    color: BLACK,
  });
  drawFooter(page, fonts);

  const headerLine = `${project.customer || ""}  ·  WO ${project.wo || ""}  ·  ${dateFmt}  ·  No.: ${report.reportNo || ""}`;
  if (leftoverWork.length) {
    await drawWorkContinuation(pdf, fonts, logoImg, headerLine, leftoverWork);
  }
  for (const ph of photos) {
    if (!ph.dataB64) continue;
    await drawPhotoPage(pdf, fonts, logoImg, headerLine, ph);
  }

  const bytes = await pdf.save();
  const copy = new Uint8Array(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

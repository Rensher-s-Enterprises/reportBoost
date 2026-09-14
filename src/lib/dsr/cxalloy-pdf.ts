import { PDFDocument, rgb, type PDFImage, type PDFPage } from "pdf-lib";
import { fmtDateDots, todayISO } from "@/lib/utils";
import type { CxalloyExportPhoto, CxalloyExportPunch, Issue, Project } from "./types";
import { dispositionLabel, photoPdfCaption, statusLabel } from "./cxalloy";
import { drawFooter, embedAppFonts, embedPhoto, loadAssets, wrap, type Fonts } from "./pdf";
import { pdfSafeText } from "./pdf-text";

const NAVY = rgb(0.106, 0.212, 0.365);
const BLACK = rgb(0.05, 0.07, 0.1);
const GREEN = rgb(0.1, 0.48, 0.29);
const MUTED = rgb(0.35, 0.4, 0.47);

export function cxalloyPdfFilename(project: Project) {
  const who = (project.wo || project.customer || "job").replace(/[^\w]+/g, "_").slice(0, 28);
  return `CXAlloy_${who}_${todayISO()}.pdf`;
}

function stamp(issue: Issue) {
  if (issue.status === "fixed") {
    const by = issue.closedBy ? ` by ${issue.closedBy}` : "";
    const at = issue.closedAtTime ? ` at ${issue.closedAtTime}` : "";
    return `CLOSED${by}${at}`;
  }
  return statusLabel(issue.status).toUpperCase();
}

export async function buildCxalloyPdf(
  project: Project,
  issues: Issue[],
  photos: CxalloyExportPhoto[],
  punches: CxalloyExportPunch[],
) {
  const assets = await loadAssets();
  const pdf = await PDFDocument.create();
  const fonts = await embedAppFonts(pdf);
  const logoImg = await pdf.embedPng(assets.logoBytes!);
  const header = `${project.customer || ""}  ·  WO ${project.wo || ""}  ·  ${project.location || ""}`;
  const closed = issues.filter((i) => i.status === "fixed").length;
  const active = issues.length - closed;

  await drawCover(pdf, fonts, logoImg, project, issues, closed, active, header);

  for (const issue of issues) {
    const issuePhotos = photos.filter((p) => p.code === issue.code);
    const issuePunches = punches.filter((p) => p.code === issue.code);
    await drawIssuePages(pdf, fonts, logoImg, header, issue, issuePhotos, issuePunches);
  }

  const bytes = await pdf.save();
  return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
}

async function drawCover(
  pdf: PDFDocument,
  fonts: Fonts,
  logoImg: PDFImage,
  project: Project,
  issues: Issue[],
  closed: number,
  active: number,
  header: string,
) {
  const page = pdf.addPage([612, 792]);
  const { width, height } = page.getSize();
  const left = 40;
  const right = width - 40;
  page.drawImage(logoImg, {
    x: (width - 133) / 2,
    y: height - 72,
    width: 133,
    height: 46,
  });
  const title = "CXALLOY CONSTRUCTION ISSUES";
  page.drawText(title, {
    x: (width - fonts.bold.widthOfTextAtSize(title, 13)) / 2,
    y: height - 96,
    size: 13,
    font: fonts.bold,
    color: NAVY,
  });
  page.drawText(header, {
    x: (width - fonts.regular.widthOfTextAtSize(header, 9)) / 2,
    y: height - 112,
    size: 9,
    font: fonts.regular,
    color: BLACK,
  });
  const summary = `${issues.length} issues  ·  ${closed} closed  ·  ${active} still open  ·  printed ${fmtDateDots(todayISO())}`;
  page.drawText(summary, {
    x: left,
    y: height - 136,
    size: 10,
    font: fonts.bold,
    color: BLACK,
  });
  let y = height - 158;
  for (const issue of issues) {
    if (y < 48) break;
    const mark = issue.status === "fixed" ? "CLOSED" : statusLabel(issue.status).toUpperCase();
    const color = issue.status === "fixed" ? GREEN : NAVY;
    page.drawText(issue.code, { x: left, y, size: 9, font: fonts.bold, color });
    page.drawText(mark, { x: left + 88, y, size: 8, font: fonts.bold, color });
    const titleLine = wrap(issue.title || issue.description || "", fonts.regular, 8.5, right - left - 170)[0];
    page.drawText(titleLine, { x: left + 170, y, size: 8.5, font: fonts.regular, color: BLACK });
    y -= 13;
  }
  drawFooter(page, fonts);
}

async function drawIssuePages(
  pdf: PDFDocument,
  fonts: Fonts,
  logoImg: PDFImage,
  header: string,
  issue: Issue,
  photos: CxalloyExportPhoto[],
  punches: CxalloyExportPunch[],
) {
  let page = pdf.addPage([612, 792]);
  let y = paintIssueHeader(page, fonts, logoImg, header, issue);
  const left = 40;
  const right = 572;
  const closedPunch = punches.find((p) => p.closed);
  if (issue.disposition && issue.disposition !== "ours") {
    y -= 2;
    page.drawText(dispositionLabel(issue.disposition).toUpperCase(), {
      x: left,
      y,
      size: 11,
      font: fonts.bold,
      color: MUTED,
    });
    y -= 14;
    if (issue.dispositionNote) {
      for (const w of wrap(issue.dispositionNote, fonts.italic, 9, right - left).slice(0, 3)) {
        page.drawText(w, { x: left, y, size: 9, font: fonts.italic, color: BLACK });
        y -= 12;
      }
    }
    y -= 4;
  }
  if (issue.status === "fixed") {
    y -= 4;
    const line = stamp(issue);
    page.drawText(line, { x: left, y, size: 12, font: fonts.bold, color: GREEN });
    y -= 16;
    if (closedPunch?.text) {
      for (const w of wrap(`Close-out: ${closedPunch.text}`, fonts.italic, 9.5, right - left).slice(0, 4)) {
        page.drawText(w, { x: left, y, size: 9.5, font: fonts.italic, color: BLACK });
        y -= 12;
      }
    }
  }
  const bits = [
    issue.priority ? `${issue.priority}${issue.priorityLabel ? ` ${issue.priorityLabel}` : ""}` : "",
    issue.asset,
    issue.discipline,
    issue.type,
    issue.assignedTo ? `Assigned ${issue.assignedTo}` : "",
    issue.dueDate ? `Due ${issue.dueDate}` : "",
  ].filter(Boolean);
  if (bits.length) {
    page.drawText(pdfSafeText(bits.join("  ·  ")), { x: left, y, size: 8.5, font: fonts.regular, color: MUTED });
    y -= 14;
  }
  const body = issue.description && issue.description !== issue.title ? issue.description : "";
  if (body) {
    page.drawText("Issue", { x: left, y, size: 9, font: fonts.bold, color: NAVY });
    y -= 13;
    for (const w of wrap(body, fonts.regular, 9.5, right - left).slice(0, 8)) {
      page.drawText(w, { x: left, y, size: 9.5, font: fonts.regular, color: BLACK });
      y -= 12;
    }
    y -= 4;
  }
  const work = punches.filter((p) => p.text);
  if (work.length) {
    page.drawText("Work on this issue", { x: left, y, size: 9, font: fonts.bold, color: NAVY });
    y -= 13;
    for (const p of work.slice(0, 8)) {
      const who = p.workers.length ? ` [${p.workers.join(", ")}]` : "";
      const line = `${fmtDateDots(p.workDate)}${p.closed ? " CLOSED" : ""}: ${p.text}${who}`;
      for (const w of wrap(line, fonts.italic, 8.5, right - left).slice(0, 3)) {
        if (y < 56) break;
        page.drawText(w, { x: left, y, size: 8.5, font: fonts.italic, color: BLACK });
        y -= 11;
      }
      y -= 3;
    }
  }
  drawFooter(page, fonts);

  const problem = photos.filter((p) => p.kind === "problem");
  const evidence = photos.filter((p) => p.kind === "evidence");
  await drawPhotoGroup(pdf, fonts, logoImg, header, issue, "Issue photos (as identified)", problem);
  await drawPhotoGroup(
    pdf,
    fonts,
    logoImg,
    header,
    issue,
    issue.status === "fixed" ? "Repair evidence — closed" : "Repair evidence",
    evidence,
  );
}

function paintIssueHeader(
  page: PDFPage,
  fonts: Fonts,
  logoImg: PDFImage,
  header: string,
  issue: Issue,
) {
  const { width, height } = page.getSize();
  page.drawImage(logoImg, {
    x: (width - 110) / 2,
    y: height - 58,
    width: 110,
    height: 38,
  });
  const closed = issue.status === "fixed";
  page.drawText(issue.code, {
    x: 40,
    y: height - 84,
    size: 16,
    font: fonts.bold,
    color: closed ? GREEN : NAVY,
  });
  const mark = closed ? "CLOSED" : statusLabel(issue.status).toUpperCase();
  page.drawText(mark, {
    x: width - 40 - fonts.bold.widthOfTextAtSize(mark, 12),
    y: height - 82,
    size: 12,
    font: fonts.bold,
    color: closed ? GREEN : NAVY,
  });
  page.drawText(header, {
    x: 40,
    y: height - 98,
    size: 8,
    font: fonts.regular,
    color: MUTED,
  });
  const titleLines = wrap(issue.title || "", fonts.bold, 11, 532).slice(0, 3);
  let y = height - 118;
  for (const line of titleLines) {
    page.drawText(line, { x: 40, y, size: 11, font: fonts.bold, color: BLACK });
    y -= 14;
  }
  return y;
}

async function drawPhotoGroup(
  pdf: PDFDocument,
  fonts: Fonts,
  logoImg: PDFImage,
  header: string,
  issue: Issue,
  label: string,
  photos: CxalloyExportPhoto[],
) {
  if (!photos.length) return;
  for (const ph of photos) {
    const page = pdf.addPage([612, 792]);
    const { width, height } = page.getSize();
    page.drawImage(logoImg, {
      x: (width - 110) / 2,
      y: height - 58,
      width: 110,
      height: 38,
    });
    page.drawText(`${issue.code}  ·  ${label}`, {
      x: 40,
      y: height - 80,
      size: 11,
      font: fonts.bold,
      color: issue.status === "fixed" && /repair/i.test(label) ? GREEN : NAVY,
    });
    page.drawText(header, { x: 40, y: height - 94, size: 8, font: fonts.regular, color: MUTED });
    const img = await embedPhoto(pdf, ph);
    if (img) {
      const maxW = 532;
      const maxH = 560;
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: (width - w) / 2, y: 120, width: w, height: h });
    }
    const cap = wrap(photoPdfCaption(issue.code, ph.caption), fonts.italic, 9, 532).slice(0, 1);
    let y = 100;
    for (const line of cap) {
      page.drawText(line, { x: 40, y, size: 9, font: fonts.italic, color: BLACK });
      y -= 12;
    }
    if (ph.workDate) {
      page.drawText(`Taken ${fmtDateDots(ph.workDate)}`, {
        x: 40,
        y: 56,
        size: 8,
        font: fonts.regular,
        color: MUTED,
      });
    }
    drawFooter(page, fonts);
  }
}

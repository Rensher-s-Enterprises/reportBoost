/**
 * pdf-lib + Carlito/fontkit can emit junk glyphs (!@#$…) when the string has
 * ligatures, smart punctuation, CID leftovers from unpdf, or control chars.
 */
export function pdfSafeText(raw: string) {
  let s = String(raw ?? "");
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+/g, " ");
  try {
    s = s.normalize("NFKC");
  } catch {
    /* ignore */
  }
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "");
  s = s.replace(/[\u2018\u2019\u201A\u2032]/g, "'");
  s = s.replace(/[\u201C\u201D\u201E\u2033]/g, '"');
  s = s.replace(/[\u2013\u2014\u2212]/g, "-");
  s = s.replace(/\u2026/g, "...");
  s = s.replace(/[\u00A0\u202F\u2007]/g, " ");
  s = s.replace(/\uFFFD/g, "");
  s = s.replace(/[\uE000-\uF8FF]/g, "");
  s = s.replace(/[^\t\x20-\x7E\u00A1-\u024F\u1E00-\u1EFF]/g, "");
  return s.replace(/ {2,}/g, " ").trim();
}

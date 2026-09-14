import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

function ascii85Decode(src: Uint8Array) {
  const s = new TextDecoder("latin1").decode(src).replace(/\s+/g, "");
  const out = new Uint8Array(Math.ceil(src.length));
  let o = 0;
  let i = s.startsWith("<~") ? 2 : 0;
  while (i < s.length) {
    if (s[i] === "~") break;
    if (s[i] === "z") {
      out[o++] = 0;
      out[o++] = 0;
      out[o++] = 0;
      out[o++] = 0;
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
    const n = Math.max(0, count - 1);
    for (let k = 0; k < n; k++) out[o++] = bytes[k];
  }
  return out.subarray(0, o);
}

function num(v: unknown) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

self.onmessage = async (ev: MessageEvent<{ bytes: ArrayBuffer }>) => {
  try {
    const bytes = new Uint8Array(ev.data.bytes);
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
        const w = num(stream.dict.get(PDFName.of("Width")));
        const h = num(stream.dict.get(PDFName.of("Height")));
        if (h < 220 || w < 240) continue;
        if (h <= 180) continue;
        if (pageIndex === 0 && pages.length > 1 && h > 900 && w > 600) continue;
        const filter = String(stream.dict.get(PDFName.of("Filter")) || "");
        let data = stream.contents;
        if (filter.includes("ASCII85")) {
          try {
            data = ascii85Decode(data);
          } catch {
            continue;
          }
        }
        if (!(data[0] === 0xff && data[1] === 0xd8)) continue;
        if (data.byteLength < 20_000 || data.byteLength > 2_400_000) continue;
        const key = `${w}x${h}:${data.byteLength}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const copy = new Uint8Array(data.byteLength);
        copy.set(data);
        n += 1;
        (self as unknown as Worker).postMessage({ jpeg: copy.buffer }, [copy.buffer]);
        if (n >= 40) {
          (self as unknown as Worker).postMessage({ done: true });
          return;
        }
      }
    }
    (self as unknown as Worker).postMessage({ done: true });
  } catch (e) {
    (self as unknown as Worker).postMessage({
      error: e instanceof Error ? e.message : "photo extract failed",
    });
  }
};

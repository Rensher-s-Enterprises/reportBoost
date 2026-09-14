function isHeicFile(file: File) {
  const n = file.name.toLowerCase();
  const t = (file.type || "").toLowerCase();
  return t.includes("heic") || t.includes("heif") || /\.hei[cf]$/.test(n);
}

export async function compressImage(file: File, maxEdge = 1400, quality = 0.8) {
  const bitmap = await loadBitmap(file, maxEdge);
  try {
    let edge = maxEdge;
    let q = quality;
    for (let attempt = 0; attempt < 3; attempt++) {
      const b64 = drawJpeg(bitmap, edge, q);
      if (b64.length <= 1_600_000) return b64;
      edge = Math.round(edge * 0.75);
      q = Math.max(0.52, q - 0.15);
    }
    return drawJpeg(bitmap, 800, 0.52);
  } finally {
    if (bitmap && "close" in bitmap && typeof bitmap.close === "function") {
      try {
        bitmap.close();
      } catch {
        /* already closed */
      }
    }
  }
}

async function bitmapFromBlob(blob: Blob, maxEdge: number): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(blob, { resizeWidth: maxEdge, resizeQuality: "low" });
  } catch {
    try {
      return await createImageBitmap(blob);
    } catch {
      const url = URL.createObjectURL(blob);
      try {
        return await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => reject(new Error("Could not read that picture. Try a JPEG or PNG."));
          i.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }
}

async function loadBitmap(file: File, maxEdge: number): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await bitmapFromBlob(file, maxEdge);
  } catch (first) {
    if (isHeicFile(file)) {
      throw new Error("Could not read that HEIC photo. In iPhone Photos: Select, Duplicate, then convert to JPEG.");
    }
    throw first instanceof Error ? first : new Error("Could not read that picture. Try a JPEG or PNG.");
  }
}

function drawJpeg(src: ImageBitmap | HTMLImageElement, maxEdge: number, quality: number) {
  const sw = "width" in src && typeof src.width === "number" ? src.width : 0;
  const sh = "height" in src && typeof src.height === "number" ? src.height : 0;
  const scale = Math.min(1, maxEdge / Math.max(sw, sh, 1));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw photo");
  ctx.drawImage(src as CanvasImageSource, 0, 0, w, h);
  const data = canvas.toDataURL("image/jpeg", quality);
  const comma = data.indexOf(",");
  return comma >= 0 ? data.slice(comma + 1) : data;
}

export async function fileToB64(file: File) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

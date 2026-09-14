import JSZip from "jszip";

export function firstFolder(path: string) {
  const parts = String(path || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p && p !== "." && !p.startsWith(".") && p !== "__MACOSX");
  if (parts.length >= 2) return parts[0];
  return "";
}

export function folderHintOf(file: File) {
  const tagged = (file as File & { folderHint?: string }).folderHint;
  if (tagged) return tagged;
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return firstFolder(rel || file.name);
}

function isPdf(file: File) {
  const n = file.name.toLowerCase();
  return file.type === "application/pdf" || n.endsWith(".pdf");
}

function isZip(file: File) {
  const n = file.name.toLowerCase();
  return (
    n.endsWith(".zip") ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed"
  );
}

async function unzipPdfs(file: File): Promise<File[]> {
  const zip = await JSZip.loadAsync(file);
  const out: File[] = [];
  const names = Object.keys(zip.files);
  for (const path of names) {
    const entry = zip.files[path];
    if (!entry || entry.dir) continue;
    const base = path.split("/").pop() || path;
    if (base.startsWith(".") || path.includes("__MACOSX")) continue;
    if (!base.toLowerCase().endsWith(".pdf")) continue;
    const blob = await entry.async("blob");
    out.push(new File([blob], path.replace(/\\/g, "/"), { type: "application/pdf" }));
  }
  return out;
}

type DirReader = {
  readEntries: (ok: (entries: unknown[]) => void, err?: (e: Error) => void) => void;
};

function asFileEntry(entry: unknown): {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file: (ok: (f: File) => void, err?: (e: Error) => void) => void;
  createReader: () => DirReader;
} | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as {
    isFile?: boolean;
    isDirectory?: boolean;
    name?: string;
    file?: (ok: (f: File) => void, err?: (e: Error) => void) => void;
    createReader?: () => DirReader;
  };
  if (typeof e.file !== "function" && typeof e.createReader !== "function") return null;
  return {
    isFile: !!e.isFile,
    isDirectory: !!e.isDirectory,
    name: String(e.name || ""),
    file: e.file || ((_ok, err) => err?.(new Error("not a file"))),
    createReader: e.createReader || (() => ({ readEntries: (ok) => ok([]) })),
  };
}

async function walkEntry(raw: unknown, prefix = ""): Promise<File[]> {
  const entry = asFileEntry(raw);
  if (!entry) return [];
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
    const rel = prefix ? `${prefix}/${file.name}` : file.name;
    const tagged = new File([file], rel, { type: file.type || "application/pdf" });
    (tagged as File & { folderHint?: string }).folderHint = firstFolder(rel);
    return [tagged];
  }
  if (!entry.isDirectory) return [];
  const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
  const reader = entry.createReader();
  const kids: unknown[] = [];
  for (;;) {
    const batch = await new Promise<unknown[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    kids.push(...batch);
  }
  const out: File[] = [];
  for (const kid of kids) out.push(...(await walkEntry(kid, nextPrefix)));
  return out;
}

async function fromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items || []);
  const out: File[] = [];
  for (const item of items) {
    const getter = (item as DataTransferItem & { webkitGetAsEntry?: () => unknown }).webkitGetAsEntry;
    const entry = getter?.call(item);
    if (entry) out.push(...(await walkEntry(entry)));
    else {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  return out.length ? out : Array.from(dt.files || []);
}

export async function planPdfImport(input: FileList | File[] | DataTransfer | null | undefined): Promise<{
  total: number;
  iterate: () => AsyncGenerator<File>;
}> {
  if (!input) return { total: 0, iterate: async function* () {} };
  const raw: File[] =
    input instanceof DataTransfer ? await fromDataTransfer(input) : Array.from(input as FileList | File[]);

  type Src =
    | { kind: "file"; file: File; size: number }
    | { kind: "zip"; zip: File; path: string; size: number };

  const srcs: Src[] = [];
  const zips: File[] = [];
  for (const file of raw) {
    if (isZip(file)) zips.push(file);
    else if (isPdf(file)) srcs.push({ kind: "file", file, size: file.size || 0 });
  }

  for (const z of zips) {
    try {
      const zip = await JSZip.loadAsync(z);
      for (const path of Object.keys(zip.files)) {
        const entry = zip.files[path];
        if (!entry || entry.dir) continue;
        const base = path.split("/").pop() || path;
        if (base.startsWith(".") || path.includes("__MACOSX")) continue;
        if (!base.toLowerCase().endsWith(".pdf")) continue;
        const data = entry as unknown as { _data?: { uncompressedSize?: number; compressedSize?: number } };
        const size =
          Number(data._data?.uncompressedSize || data._data?.compressedSize || 0) || 0;
        srcs.push({ kind: "zip", zip: z, path: path.replace(/\\/g, "/"), size });
      }
    } catch {
      /* skip a bad zip */
    }
  }

  srcs.sort((a, b) => a.size - b.size || (a.kind === "file" ? a.file.name : a.path).localeCompare(b.kind === "file" ? b.file.name : b.path));

  const unique: Src[] = [];
  const seenSize = new Set<number>();
  for (const src of srcs) {
    if (src.size && seenSize.has(src.size)) continue;
    if (src.size) seenSize.add(src.size);
    unique.push(src);
  }

  return {
    total: unique.length,
    iterate: async function* () {
      const zipCache = new Map<File, JSZip>();
      for (const src of unique) {
        if (src.kind === "file") {
          yield src.file;
          continue;
        }
        let zip = zipCache.get(src.zip);
        if (!zip) {
          zip = await JSZip.loadAsync(src.zip);
          zipCache.set(src.zip, zip);
        }
        const entry = zip.files[src.path];
        if (!entry || entry.dir) continue;
        const blob = await entry.async("blob");
        const file = new File([blob], src.path, { type: "application/pdf" });
        (file as File & { folderHint?: string }).folderHint = firstFolder(src.path);
        yield file;
      }
      zipCache.clear();
    },
  };
}

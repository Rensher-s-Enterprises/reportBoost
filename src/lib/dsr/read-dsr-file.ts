import { refineDsrImport } from "./ai";
import {
  collectDateSignals,
  jobFromFilename,
  looksLikeCxalloyList,
  parseDsrText,
  validWorkOrder,
  type DateSignals,
  type ParsedDsr,
} from "./parse-dsr";
import { mergeRefinedDsr, shouldRefineDsr, type IssueHint } from "./refine-import";
import { entryIssueCodes } from "./cxalloy";

function sniffPdfText(bytes: Uint8Array) {
  const n = bytes.length;
  const raw = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(n, 280_000)));
  const chunks: string[] = [];
  const paren = /\((?:\\.|[^\\)]){3,180}\)/g;
  for (const m of raw.matchAll(paren)) {
    const t = m[0]
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\([()\\])/g, "$1");
    if (/[A-Za-z]{3}/.test(t) && t.length < 200) chunks.push(t);
  }
  const labels =
    /(?:Date|WO|Customer|Location|Job Task|Work Performed|Time On|Time Off|Technician|Comments|Material Used|No\.)\s*:[^\n]{0,180}/gi;
  for (const m of raw.matchAll(labels)) chunks.push(m[0]);
  return chunks.join("\n");
}

async function extractPdfText(bytes: Uint8Array) {
  try {
    const { extractText } = await import("unpdf");
    const extracted = await extractText(bytes.slice(), { mergePages: true });
    const raw = extracted.text as unknown as string | string[];
    const text = (Array.isArray(raw) ? raw.join("\n") : String(raw || "")).trim();
    const letters = text.replace(/\s+/g, "");
    if (letters.length > 80) return text;
  } catch {
    /* scanned / encrypted PDFs still have a sniff fallback */
  }
  return sniffPdfText(bytes);
}

export async function parseDsrFile(
  file: File,
  opts?: { issues?: IssueHint[] },
): Promise<
  | { ok: true; parsed: ParsedDsr; signals: DateSignals; inferredCodes: string[] }
  | { ok: false; error: string }
> {
  let buf: ArrayBuffer;
  try {
    buf = await file.arrayBuffer();
  } catch {
    return { ok: false, error: "Could not read that file." };
  }
  const bytes = new Uint8Array(buf);
  const name = file.name.split("/").pop() || file.name;
  try {
    const text = await extractPdfText(bytes);
    if (looksLikeCxalloyList(text)) {
      return { ok: false, error: "That looks like a CXAlloy list, not a daily report." };
    }
    let parsed = parseDsrText(text, name);
    const fromName = jobFromFilename(name);
    if (!validWorkOrder(parsed.wo) && fromName.wo) parsed.wo = fromName.wo;
    if (!parsed.customer && fromName.customer) parsed.customer = fromName.customer;
    let llmDraft = {};
    if (shouldRefineDsr(parsed, text, opts?.issues)) {
      try {
        const llm = await refineDsrImport({
          data: {
            text: text.slice(0, 12_000),
            parsed: {
              workDate: parsed.workDate,
              reportNo: parsed.reportNo,
              customer: parsed.customer,
              wo: parsed.wo,
              location: parsed.location,
              technician: parsed.technician,
              jobTask: parsed.jobTask,
              timeOn: parsed.timeOn,
              timeOff: parsed.timeOff,
              comments: parsed.comments,
              entries: parsed.entries.map((e) => ({
                time: e.time,
                text: e.text,
                cxalloy: e.cxalloy,
                cxalloys: e.cxalloys,
                closedCodes: e.closedCodes,
                workers: e.workers,
                kind: e.kind,
              })),
            },
            issues: opts?.issues,
          },
        });
        if (llm.ok) llmDraft = llm.parsed;
      } catch {
        /* keep the local parse */
      }
    }
    const beforeCodes = new Set(parsed.entries.flatMap((e) => entryIssueCodes(e)));
    if (opts?.issues?.length || Object.keys(llmDraft).length) {
      parsed = mergeRefinedDsr(parsed, llmDraft, opts?.issues);
    }
    const inferredCodes = [
      ...new Set(parsed.entries.flatMap((e) => entryIssueCodes(e)).filter((c) => !beforeCodes.has(c))),
    ];
    const signals = collectDateSignals(text, name, parsed.reportNo);
    if (!parsed.workDate) {
      parsed.workDate = signals.fileDate || signals.headerDate || signals.reportNoDate;
    }
    if (!parsed.workDate && !signals.options.length) {
      return { ok: false, error: "Could not read the date. Rename it like 09.05.2026.pdf." };
    }
    return { ok: true, parsed, signals, inferredCodes };
  } catch {
    return { ok: false, error: "Could not read that PDF." };
  }
}

function jpegFile(n: number, buf: ArrayBuffer) {
  return new File([buf], `photo-${n}.jpg`, { type: "image/jpeg" });
}

export async function* jpegFilesFromPdfFile(file: File): AsyncGenerator<File> {
  let worker: Worker | null = null;
  try {
    const buf = await file.arrayBuffer();
    worker = new Worker(new URL("./photo-extract.worker.ts", import.meta.url), { type: "module" });
    const queue: ArrayBuffer[] = [];
    let done = false;
    let err = "";
    worker.onmessage = (ev: MessageEvent<{ jpeg?: ArrayBuffer; done?: boolean; error?: string }>) => {
      if (ev.data.jpeg) queue.push(ev.data.jpeg);
      if (ev.data.done) done = true;
      if (ev.data.error) {
        err = ev.data.error;
        done = true;
      }
    };
    worker.onerror = () => {
      done = true;
    };
    worker.postMessage({ bytes: buf }, [buf]);
    const start = Date.now();
    let i = 0;
    while (!done || queue.length) {
      if (Date.now() - start > 25_000) break;
      if (queue.length) {
        i += 1;
        yield jpegFile(i, queue.shift()!);
        continue;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    void err;
  } catch {
    /* skip pictures rather than take the tab down */
  } finally {
    try {
      worker?.terminate();
    } catch {
      /* already gone */
    }
  }
}

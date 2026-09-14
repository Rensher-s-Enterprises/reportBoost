import { toast } from "sonner";
import { addPhotosBatch, importParsedDay, listIssues } from "./api";
import { folderHintOf, planPdfImport } from "./collect-pdfs";
import { jpegFilesFromPdfFile, parseDsrFile } from "./read-dsr-file";
import { compressImage, fileToB64 } from "./image";
import { queryClient } from "@/lib/query";
import type { DateOption, ParsedDsr } from "./parse-dsr";

export type BulkProgress = {
  done: number;
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  jobs: number;
  photos: number;
  needsDate: number;
  current: string;
};

export type DateConflict = {
  id: string;
  file: File;
  parsed: ParsedDsr;
  folderHint: string;
  options: DateOption[];
};

function pause(ms = 80) {
  return new Promise((r) => setTimeout(r, ms));
}

async function yieldToUi(heavy = false) {
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else resolve();
  });
  await pause(heavy ? 240 : 90);
}

async function shrinkPhoto(file: File) {
  try {
    if (file.size > 12_000 && file.size < 380_000) {
      return await fileToB64(file);
    }
    return await compressImage(file, 900, 0.6);
  } catch {
    return "";
  }
}

export async function attachImportedPhotos(
  file: File,
  reportId: string,
  onTick?: (n: number, label: string) => void,
) {
  const label = file.name.split("/").pop() || file.name;
  const heavy = file.size > 1_200_000;
  let added = 0;
  let n = 0;
  try {
    for await (const pic of jpegFilesFromPdfFile(file)) {
      n += 1;
      onTick?.(n, label);
      const dataB64 = await shrinkPhoto(pic);
      if (!dataB64 || dataB64.length > 1_600_000) continue;
      const saved = await addPhotosBatch({
        data: { reportId, photos: [{ dataB64, mime: "image/jpeg" }] },
      });
      added += saved.added || 0;
      if (!saved.ok) break;
      await pause(heavy ? 70 : 25);
    }
  } catch {
    /* keep the day even if pictures fail */
  }
  return added;
}

export async function importResolvedDay(opts: {
  file: File;
  parsed: ParsedDsr;
  workDate: string;
  projectId?: string;
  folderHint?: string;
  onTick?: (n: number, label: string) => void;
}) {
  const parsed = { ...opts.parsed, workDate: opts.workDate };
  const res = await importParsedDay({
    data: {
      projectId: opts.projectId,
      folderHint: opts.folderHint || folderHintOf(opts.file),
      parsed,
    },
  });
  if (!res.ok) return { ...res, photos: 0 };
  if (res.skipped) return { ...res, photos: 0 };
  const photos = await attachImportedPhotos(opts.file, res.reportId, opts.onTick);
  return { ...res, photos };
}

export async function bulkImportDsrs(opts: {
  projectId?: string;
  input: FileList | File[] | DataTransfer | null | undefined;
  existingDates?: Iterable<string>;
  onProgress?: (p: BulkProgress) => void;
}) {
  let plan: { total: number; iterate: () => AsyncGenerator<File> };
  try {
    plan = await planPdfImport(opts.input);
  } catch {
    toast.error("Could not read those files.");
    return {
      imported: 0,
      skipped: 0,
      failed: 0,
      jobs: 0,
      lastId: "",
      lastProjectId: "",
      conflicts: [] as DateConflict[],
    };
  }
  if (!plan.total) {
    toast.error("No PDF reports in that drop. Add PDFs, a folder, or a ZIP of PDFs.");
    return {
      imported: 0,
      skipped: 0,
      failed: 0,
      jobs: 0,
      lastId: "",
      lastProjectId: "",
      conflicts: [] as DateConflict[],
    };
  }

  const have = new Set(
    opts.projectId ? [...(opts.existingDates || [])].map((d) => `${opts.projectId}:${d}`) : [],
  );
  let issueHints: { code: string; title: string }[] = [];
  if (opts.projectId) {
    try {
      const issues = await listIssues({ data: { projectId: opts.projectId } });
      issueHints = issues
        .map((i) => ({ code: i.code, title: i.title, description: i.description }))
        .slice(0, 60);
    } catch {
      issueHints = [];
    }
  }
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const inferredAll: string[] = [];
  let jobs = 0;
  let photos = 0;
  let lastId = "";
  let lastProjectId = opts.projectId || "";
  const seenJobs = new Set<string>();
  const conflicts: DateConflict[] = [];
  let i = 0;

  const tick = (current: string) =>
    opts.onProgress?.({
      done: i,
      total: plan.total,
      imported,
      skipped,
      failed,
      jobs,
      photos,
      needsDate: conflicts.length,
      current,
    });

  for await (const file of plan.iterate()) {
    const label = file.name.split("/").pop() || file.name;
    const heavy = file.size > 1_200_000;
    tick(`${label}${heavy ? " · large file" : ""}`);
    try {
      const read = await parseDsrFile(file, { issues: issueHints });
      await yieldToUi(heavy);
      if (!read.ok) {
        failed += 1;
        if (plan.total === 1) toast.error(read.error);
        i += 1;
        await yieldToUi(heavy);
        continue;
      }

      if (read.signals.conflict) {
        conflicts.push({
          id: crypto.randomUUID(),
          file,
          parsed: read.parsed,
          folderHint: folderHintOf(file),
          options: read.signals.options.length
            ? read.signals.options
            : [{ iso: read.parsed.workDate, label: "Best guess" }],
        });
        i += 1;
        await yieldToUi();
        continue;
      }

      const day = read.parsed.workDate;
      const keyGuess = opts.projectId && day ? `${opts.projectId}:${day}` : "";
      if (keyGuess && have.has(keyGuess)) {
        skipped += 1;
        i += 1;
        continue;
      }

      const res = await importParsedDay({
        data: {
          projectId: opts.projectId,
          folderHint: folderHintOf(file),
          parsed: read.parsed,
        },
      });
      if (!res.ok) {
        failed += 1;
        if (plan.total === 1) toast.error(res.error);
        i += 1;
        await yieldToUi(heavy);
        continue;
      }
      if (res.projectId) {
        lastProjectId = res.projectId;
        if (res.jobCreated && !seenJobs.has(res.projectId)) jobs += 1;
        seenJobs.add(res.projectId);
        have.add(`${res.projectId}:${res.workDate}`);
      }
      if (res.skipped) {
        skipped += 1;
        i += 1;
        await yieldToUi();
        continue;
      }

      imported += 1;
      lastId = res.reportId;
      if (read.inferredCodes?.length) inferredAll.push(...read.inferredCodes);
      tick(`${label} · pictures`);
      try {
        photos += await attachImportedPhotos(file, res.reportId, (n, name) =>
          tick(`${name} · picture ${n}`),
        );
      } catch {
        /* day is already saved */
      }
    } catch (e) {
      failed += 1;
      if (plan.total === 1) {
        toast.error(e instanceof Error ? e.message : "Could not import that PDF");
      }
    }
    i += 1;
    await yieldToUi(heavy);
  }

  tick("");
  try {
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
    if (opts.projectId) {
      await queryClient.invalidateQueries({ queryKey: ["reports", opts.projectId] });
    }
  } catch {
    /* list will refresh on next visit */
  }

  const bits = [`${imported} new`];
  if (photos) bits.push(`${photos} pictures`);
  if (jobs) bits.push(`${jobs} job${jobs === 1 ? "" : "s"} created`);
  if (skipped) bits.push(`${skipped} already on file`);
  if (conflicts.length) bits.push(`${conflicts.length} need a date`);
  if (failed) bits.push(`${failed} failed`);
  const uniqueInferred = [...new Set(inferredAll)];
  if (uniqueInferred.length) {
    toast.message(
      `Assigned CXAlloy ${uniqueInferred.slice(0, 6).join(", ")}${uniqueInferred.length > 6 ? "…" : ""} from the work description.`,
    );
  }
  if (conflicts.length) {
    toast.message(`Imported ${plan.total} file${plan.total === 1 ? "" : "s"} · ${bits.join(" · ")}`);
  } else {
    toast.success(`Imported ${plan.total} file${plan.total === 1 ? "" : "s"} · ${bits.join(" · ")}`);
  }
  return { imported, skipped, failed, jobs, lastId, lastProjectId, conflicts };
}

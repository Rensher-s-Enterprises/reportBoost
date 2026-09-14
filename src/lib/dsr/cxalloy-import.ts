import { toast } from "sonner";
import { parseCxalloyText, refineCxalloyImport } from "./ai";
import { importCxalloySeeds } from "./api";
import {
  extractCxalloyIssuePhotos,
  looksLikeCxalloyList,
  looksLikeFormChrome,
} from "./parse-dsr";
import {
  issueEvidenceCaption,
  mergeCxalloySeeds,
  parseCxalloyDocument,
  type IssueSeed,
} from "./cxalloy";
import { queryClient } from "@/lib/query";

async function extractPdfText(bytes: Uint8Array) {
  const { extractText } = await import("unpdf");
  const extracted = await extractText(bytes.slice(), { mergePages: true });
  const raw = extracted.text as unknown as string | string[];
  return (Array.isArray(raw) ? raw.join("\n") : String(raw || "")).trim();
}

function seedFromLlm(issue: {
  code: string;
  title: string;
  description: string;
  status?: "open" | "in_progress" | "fixed";
  priority?: string;
  priorityLabel?: string;
  assignedTo?: string;
  asset?: string;
  discipline?: string;
  type?: string;
  dueDate?: string;
  createdBy?: string;
  identifiedOn?: string;
  disposition?: IssueSeed["disposition"];
  dispositionNote?: string;
}): IssueSeed {
  const status = issue.status || "in_progress";
  return {
    code: issue.code,
    title: issue.title,
    description: issue.description,
    status,
    statusLabel: status === "fixed" ? "CLOSED" : status === "open" ? "OPEN" : "IN PROGRESS",
    priority: issue.priority || "",
    priorityLabel: issue.priorityLabel || "",
    assignedTo: issue.assignedTo || "",
    asset: issue.asset || "",
    discipline: issue.discipline || "",
    type: issue.type || "",
    dueDate: issue.dueDate || "",
    createdBy: issue.createdBy || "",
    identifiedOn: issue.identifiedOn || "",
    disposition: issue.disposition,
    dispositionNote: issue.dispositionNote,
  };
}

async function seedsFromText(text: string): Promise<IssueSeed[] | { error: string }> {
  if (!text.trim()) return { error: "Nothing to parse." };
  let seeds = parseCxalloyDocument(text);
  if (seeds.length) {
    try {
      const refined = await refineCxalloyImport({
        data: {
          text: text.slice(0, 16_000),
          seeds: seeds.slice(0, 80).map((s) => ({
            code: s.code,
            title: s.title,
            description: s.description,
            status: s.status,
            priority: s.priority,
            asset: s.asset,
            assignedTo: s.assignedTo,
          })),
        },
      });
      if (refined.ok) seeds = mergeCxalloySeeds(seeds, refined.issues.map(seedFromLlm));
    } catch {
      /* keep the parser list */
    }
  }
  if (seeds.length < 3) {
    const parsed = await parseCxalloyText({ data: { text: text.slice(0, 40_000) } });
    if (!parsed.ok) {
      if (!seeds.length) return { error: parsed.error };
    } else {
      const llmSeeds = parsed.issues.map(seedFromLlm);
      seeds = seeds.length ? mergeCxalloySeeds(seeds, llmSeeds) : llmSeeds;
    }
  }
  seeds = seeds.filter((s) => s.code && !looksLikeFormChrome(s.code));
  if (!seeds.length) return { error: "Could not find CHK / FO issues in that file." };
  return seeds;
}

export async function importCxalloyFromText(projectId: string, text: string) {
  const seeds = await seedsFromText(text);
  if ("error" in seeds) return { ok: false as const, error: seeds.error };
  try {
    const res = await importCxalloySeeds({ data: { projectId, seeds } });
    await queryClient.invalidateQueries({ queryKey: ["issues", projectId] });
    await queryClient.refetchQueries({ queryKey: ["issues", projectId] });
    return res;
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Could not save those issues.",
    };
  }
}

export async function importCxalloyFromFile(projectId: string, file: File) {
  let buf: ArrayBuffer;
  try {
    buf = await file.arrayBuffer();
  } catch {
    return { ok: false as const, error: "Could not read that file." };
  }
  const bytes = new Uint8Array(buf);
  let text = "";
  try {
    text = await extractPdfText(bytes);
  } catch {
    return { ok: false as const, error: "Could not read text from that PDF." };
  }
  if (!text.trim() && !looksLikeCxalloyList(text)) {
    return {
      ok: false as const,
      error: "Could not read text from that file. Paste the issue list or use a text export.",
    };
  }
  const seeds = await seedsFromText(text);
  if ("error" in seeds) return { ok: false as const, error: seeds.error };

  let first: Awaited<ReturnType<typeof importCxalloySeeds>>;
  try {
    first = await importCxalloySeeds({ data: { projectId, seeds } });
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : "Could not save those issues.",
    };
  }
  let photosAdded = 0;
  try {
    const mapped = await extractCxalloyIssuePhotos(bytes);
    const bySeed = new Map(seeds.map((s) => [s.code, s]));
    const batch: { code: string; dataB64: string; mime?: string; caption?: string }[] = [];
    for (const { code, photos } of mapped) {
      const seed = bySeed.get(code);
      const caption = issueEvidenceCaption({
        code,
        title: seed?.title,
        description: seed?.description,
      });
      for (const ph of photos.slice(0, 8)) {
        if (ph.dataB64.length > 2_400_000) continue;
        batch.push({ code, dataB64: ph.dataB64, mime: ph.mime, caption });
      }
    }
    for (let i = 0; i < batch.length; i += 4) {
      const chunk = batch.slice(i, i + 4);
      try {
        const saved = await importCxalloySeeds({ data: { projectId, seeds: [], photos: chunk } });
        photosAdded += saved.photosAdded || 0;
      } catch {
        const saved = await importCxalloySeeds({
          data: { projectId, seeds: [], photos: chunk.slice(0, 1) },
        });
        photosAdded += saved.photosAdded || 0;
      }
    }
    if (batch.length && !photosAdded) {
      toast.message("Issues imported, but the evidence photos did not save. Import the PDF again.");
    }
  } catch (e) {
    toast.message(
      e instanceof Error
        ? `Issues imported. Photos could not be read: ${e.message}`
        : "Issues imported. Photos from that PDF could not be read — add them on each issue.",
    );
  }
  await queryClient.invalidateQueries({ queryKey: ["issues", projectId] });
  await queryClient.refetchQueries({ queryKey: ["issues", projectId] });
  await queryClient.invalidateQueries({ queryKey: ["issue-photos"] });
  return { ...first, photosAdded };
}

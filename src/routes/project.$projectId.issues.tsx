import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { SignInGate, RedirectToSignIn } from "@/lib/auth/gates";
import {
  addIssuePhoto,
  closeIssue,
  deleteIssue,
  deleteIssuePhoto,
  deletePhoto,
  getCxalloyExportBundle,
  getProject,
  getReport,
  listIssuePhotos,
  listIssues,
  openDayReport,
  saveIssue,
  saveReport,
  setIssueDisposition,
  updateIssuePhoto,
  updatePhotoMeta,
  upsertIssueFromPunch,
} from "@/lib/dsr/api";
import { buildCxalloyPdf, cxalloyPdfFilename } from "@/lib/dsr/cxalloy-pdf";
import { downloadBlob } from "@/lib/dsr/pdf";
import { importCxalloyFromFile } from "@/lib/dsr/cxalloy-import";
import { chainEntries, emptyPunch } from "@/lib/dsr/timeline";
import { readUnsyncedDraft } from "@/lib/dsr/draft";
import {
  EMPTY_FILTERS,
  dispositionLabel,
  filterIssues,
  issueEvidenceCaption,
  normalizeIssueCode,
  type IssueFilters,
} from "@/lib/dsr/cxalloy";
import { todayISO } from "@/lib/utils";
import { compressImage } from "@/lib/dsr/image";
import { queryClient } from "@/lib/query";
import { AppShell, ModalSheet, Panel, SectionLabel } from "@/components/dsr/shell";
import { IssueCard, IssueFiltersBar } from "@/components/dsr/issue-picker";
import { PhotoDrop } from "@/components/dsr/photo-drop";
import { PhotoThumb } from "@/components/dsr/photo-thumb";
import { PhotoLightbox, type LightboxItem } from "@/components/dsr/photo-lightbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { nowHHMM } from "@/lib/dsr/timeline";
import type { Issue, IssuePhoto } from "@/lib/dsr/types";

export const Route = createFileRoute("/project/$projectId/issues")({
  component: IssuesPage,
});

function IssuesPage() {
  const { projectId } = Route.useParams();
  return (
    <SignInGate fallback={<RedirectToSignIn />}>
      <Inner id={projectId} />
    </SignInGate>
  );
}

function Inner({ id }: { id: string }) {
  const user = useCurrentUser();
  const qc = useQueryClient();
  const projectQ = useQuery({ queryKey: ["project", id], queryFn: () => getProject({ data: id }) });
  const issuesQ = useQuery({
    queryKey: ["issues", id],
    queryFn: () => listIssues({ data: { projectId: id } }),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const [filters, setFilters] = useState<IssueFilters>(EMPTY_FILTERS);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState<Issue | null>(null);
  const issues = useMemo(() => {
    const d = issuesQ.data;
    return Array.isArray(d) ? d : [];
  }, [issuesQ.data, issuesQ.dataUpdatedAt]);
  const list = useMemo(() => filterIssues(issues, filters), [issues, filters]);
  const openN = issues.filter((i) => i.status === "open").length;
  const progressN = issues.filter((i) => i.status === "in_progress").length;
  const closedN = issues.filter((i) => i.status === "fixed").length;
  const disputeN = issues.filter((i) => i.disposition === "disputed").length;

  async function refreshIssues() {
    await issuesQ.refetch();
  }

  async function exportPack() {
    setExporting(true);
    try {
      toast.message("Building CXAlloy PDF…");
      const bundle = await getCxalloyExportBundle({ data: id });
      const blob = await buildCxalloyPdf(
        bundle.project,
        bundle.issues,
        bundle.photos,
        bundle.punches,
      );
      downloadBlob(blob, cxalloyPdfFilename(bundle.project));
      const closed = bundle.issues.filter((i) => i.status === "fixed").length;
      const evidence = bundle.photos.filter((p) => p.kind === "evidence").length;
      toast.success(
        `CXAlloy PDF ready · ${bundle.issues.length} issues · ${closed} closed · ${evidence} repair photos`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not export CXAlloy");
    } finally {
      setExporting(false);
    }
  }

  async function onPdf(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const res = await importCxalloyFromFile(id, file);
      await refreshIssues();
      if (!res.ok) toast.error(res.error);
      else {
        const pics = "photosAdded" in res && res.photosAdded ? ` · ${res.photosAdded} photos` : "";
        toast.success(
          `Imported ${res.total} issues · ${res.added} new · ${res.keptFixed} already closed${pics}`,
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function markFixedOnToday(issue: Issue) {
    await closeIssue({
      data: {
        id: issue.id,
        closedBy: user?.displayName || "Field",
        closedAtTime: nowHHMM(),
        minutesSpent: 0,
      },
    });
    const day = todayISO();
    const report = await openDayReport({ data: { projectId: id, workDate: day } });
    const server = (await getReport({ data: report.id })) || report;
    const full = readUnsyncedDraft(server.id) || server;
    const punch = emptyPunch({
      text: `Completed work on ${issue.code}${issue.title ? ` (${issue.title})` : ""} and marked the issue fixed.`,
      cxalloy: issue.code,
      closed: true,
      workers: [user?.displayName || ""].filter(Boolean),
    });
    await saveReport({
      data: {
        ...full,
        entries: chainEntries([...(full.entries || []), punch], full.timeOff),
      },
    });
    qc.setQueryData<Issue[]>(["issues", id], (prev) =>
      (prev ?? []).map((row) => (row.id === issue.id ? { ...row, status: "fixed" as const } : row)),
    );
    await refreshIssues();
    await qc.invalidateQueries({ queryKey: ["report", full.id] });
    await qc.invalidateQueries({ queryKey: ["reports", id] });
  }

  async function addCode(closed = false) {
    const code = normalizeIssueCode(typed);
    if (!code) return;
    await upsertIssueFromPunch({
      data: {
        projectId: id,
        code,
        closed,
        closedBy: user?.displayName || "Field",
        closedAtTime: nowHHMM(),
        notes: closed ? "Closed from the field before the CXAlloy list was imported." : "",
      },
    });
    setTyped("");
    await refreshIssues();
    toast.success(closed ? `${code} added and marked closed` : `${code} added`);
  }

  return (
    <AppShell
        title="CXAlloy issues"
        eyebrow={projectQ.data?.name || "Job"}
        backTo={`/project/${id}`}
        jobId={id}
      >
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            n={String(openN)}
            l="Open"
            active={filters.status === "open"}
            onClick={() =>
              setFilters({ ...filters, status: filters.status === "open" ? "" : "open" })
            }
          />
          <Stat
            n={String(progressN)}
            l="In progress"
            active={filters.status === "in_progress"}
            onClick={() =>
              setFilters({
                ...filters,
                status: filters.status === "in_progress" ? "" : "in_progress",
              })
            }
          />
          <Stat
            n={String(closedN)}
            l="Closed"
            active={filters.status === "fixed"}
            onClick={() =>
              setFilters({ ...filters, status: filters.status === "fixed" ? "" : "fixed" })
            }
          />
          <Stat
            n={String(disputeN)}
            l="In dispute"
            active={filters.disposition === "disputed"}
            onClick={() =>
              setFilters({
                ...filters,
                disposition: filters.disposition === "disputed" ? "" : "disputed",
              })
            }
          />
        </div>
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <label className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-xl border border-line bg-card px-4 text-sm font-semibold text-navy">
            {busy ? "Importing…" : (
              <>
                <span className="sm:hidden">Import PDF</span>
                <span className="hidden sm:inline">Import CXAlloy PDF</span>
              </>
            )}
            <input
              type="file"
              accept="application/pdf,.pdf"
              hidden
              disabled={busy}
              onChange={(e) => {
                void onPdf(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <Button
            type="button"
            variant="cyan"
            width="full"
            disabled={exporting || !issues.length}
            onClick={() => void exportPack()}
          >
            {exporting ? "Building PDF…" : (
              <>
                <span className="sm:hidden">Export PDF</span>
                <span className="hidden sm:inline">Export CXAlloy PDF</span>
              </>
            )}
          </Button>
        </div>
        <Panel className="mb-4 p-3 sm:p-4">
          <p className="mb-2 text-xs font-bold tracking-widest text-muted uppercase">
            Add a code before the list is imported
          </p>
          <div className="flex gap-2">
            <Input
              value={typed}
              placeholder="CHK-123 or FO-24-24"
              onChange={(e) => setTyped(e.target.value)}
            />
            <Button type="button" variant="ghost" onClick={() => void addCode(false)}>
              Add
            </Button>
          </div>
          <button
            type="button"
            className="mt-2 min-h-11 text-sm font-semibold text-cyan-2"
            onClick={() => void addCode(true)}
          >
            Add and mark closed
          </button>
        </Panel>
        <IssueFiltersBar issues={issues} filters={filters} onChange={setFilters} />
        <SectionLabel className="mt-3">
          {list.length} shown · {todayISO()}
        </SectionLabel>
        <div className="space-y-2">
          {list.length ? (
            list.map((i) => (
              <div key={i.id} className="space-y-1">
                <IssueCard issue={i} onSelect={() => setOpen(i)} />
                {i.status !== "fixed" ? (
                  <button
                    type="button"
                    className="ml-1 text-xs font-semibold text-cyan-2"
                    onClick={() => {
                      void markFixedOnToday(i)
                        .then(() => {
                          setOpen({ ...i, status: "fixed" });
                          toast.message("Closed on today's report. Add close-out pictures — they print on the official PDF.");
                        })
                        .catch((e) =>
                          toast.error(e instanceof Error ? e.message : "Could not mark fixed"),
                        );
                    }}
                  >
                    Mark fixed
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ml-1 text-xs font-semibold text-muted"
                    onClick={() => {
                      void closeIssue({
                        data: {
                          id: i.id,
                          closedBy: "",
                          closedAtTime: "",
                          minutesSpent: 0,
                          reopen: true,
                        },
                      }).then(() => {
                        setOpen({ ...i, status: "open", closedBy: "", closedAtTime: "" });
                        qc.setQueryData<Issue[]>(["issues", id], (prev) =>
                          (prev ?? []).map((row) =>
                            row.id === i.id ? { ...row, status: "open" as const } : row,
                          ),
                        );
                        void refreshIssues();
                        toast.message("Issue reopened");
                      });
                    }}
                  >
                    Reopen
                  </button>
                )}
              </div>
            ))
          ) : (
            <Panel className="px-5 py-10 text-center">
              <h2 className="text-lg font-semibold">No issues on this job yet</h2>
              <p className="mt-1 text-sm text-muted">
                Import a Construction Issues PDF, or type a CHK / FO code you already closed in the
                field.
              </p>
            </Panel>
          )}
        </div>
      {open ? <IssueDetail projectId={id} issue={open} onClose={() => setOpen(null)} /> : null}
    </AppShell>
  );
}

function IssueDetail({
  projectId,
  issue,
  onClose,
}: {
  projectId: string;
  issue: Issue;
  onClose: () => void;
}) {
  const photosQ = useQuery({
    queryKey: ["issue-photos", projectId, issue.code],
    queryFn: () => listIssuePhotos({ data: { projectId, code: issue.code } }),
  });
  const photos = photosQ.data ?? [];
  const problem = photos.filter((p) => p.kind === "problem");
  const evidence = photos.filter((p) => p.kind === "evidence");
  const [disp, setDisp] = useState(issue.disposition);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description);
  const [priority, setPriority] = useState(issue.priority);
  const [asset, setAsset] = useState(issue.asset);
  const qc = useQueryClient();

  return (
    <ModalSheet onClose={onClose} wide>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-widest text-muted uppercase">{issue.status}</p>
            <h2 className="text-lg font-semibold">{issue.code}</h2>
            {editing ? null : <p className="text-sm text-ink">{issue.title}</p>}
          </div>
          <button type="button" className="text-sm font-semibold text-cyan-2" onClick={onClose}>
            Close
          </button>
        </div>
        {editing ? (
          <div className="mb-3 space-y-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea
              className="min-h-24 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Priority P1–P3"
                value={priority}
                onChange={(e) => setPriority(e.target.value.toUpperCase())}
              />
              <Input placeholder="Asset" value={asset} onChange={(e) => setAsset(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button
                width="full"
                onClick={async () => {
                  await saveIssue({
                    data: {
                      ...issue,
                      projectId,
                      title,
                      description,
                      priority,
                      asset,
                    },
                  });
                  await qc.invalidateQueries({ queryKey: ["issues", projectId] });
                  await qc.refetchQueries({ queryKey: ["issues", projectId] });
                  setEditing(false);
                  toast.success("Issue updated");
                }}
              >
                Save issue
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : issue.description ? (
          <p className="mb-3 text-sm text-muted">{issue.description}</p>
        ) : null}
        <p className="text-xs text-muted">
          {[issue.asset, issue.priority, issue.dueDate ? `Due ${issue.dueDate}` : ""]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {issue.closedBy ? (
          <p className="mt-1 text-xs text-muted">
            Closed by {issue.closedBy}
            {issue.closedAtTime ? ` at ${issue.closedAtTime}` : ""}
          </p>
        ) : null}
        {disp && disp !== "ours" ? (
          <p className="mt-2 rounded-xl bg-paper px-3 py-2 text-sm text-ink">
            <span className="font-semibold">{dispositionLabel(disp)}.</span>{" "}
            {issue.dispositionNote || "Not a field fix for MCG as assigned."}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(
            [
              ["ours", "MCG to fix"],
              ["reassigned", "Reassigned"],
              ["disputed", "In dispute"],
              ["as_designed", "As designed"],
              ["needs_engineering", "Eng. review"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`min-h-10 rounded-full px-3 text-xs font-semibold ${
                disp === id ? "bg-navy text-card" : "bg-paper text-navy"
              }`}
              onClick={() => {
                void setIssueDisposition({
                  data: { id: issue.id, disposition: id, note: issue.dispositionNote },
                }).then(() => {
                  setDisp(id);
                  qc.setQueryData<Issue[]>(["issues", projectId], (prev) =>
                    (prev ?? []).map((row) =>
                      row.id === issue.id ? { ...row, disposition: id } : row,
                    ),
                  );
                  void qc.invalidateQueries({ queryKey: ["issues", projectId] });
                  void qc.refetchQueries({ queryKey: ["issues", projectId] });
                  toast.success(label);
                });
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" width="full" onClick={() => setEditing(true)}>
            Edit issue
          </Button>
          <Button
            variant="ghost"
            width="full"
            onClick={async () => {
              if (!confirm(`Delete ${issue.code} from this job?`)) return;
              await deleteIssue({ data: issue.id });
              await qc.invalidateQueries({ queryKey: ["issues", projectId] });
              await qc.refetchQueries({ queryKey: ["issues", projectId] });
              toast.success(`${issue.code} deleted`);
              onClose();
            }}
          >
            Delete
          </Button>
        </div>

        <p className="mt-4 mb-2 text-xs font-bold tracking-widest text-muted uppercase">
          Problem photos
        </p>
        <IssuePhotoBank
          projectId={projectId}
          code={issue.code}
          kind="problem"
          photos={problem}
          empty="Drop or pick the pictures that came with the issue."
        />
        <p className="mt-4 mb-2 text-xs font-bold tracking-widest text-muted uppercase">
          Close-out evidence
        </p>
        <p className="mb-2 text-sm text-muted">
          These pictures print on the official daily PDF labeled with the CXAlloy code.
        </p>
        <IssuePhotoBank
          projectId={projectId}
          code={issue.code}
          kind="evidence"
          photos={evidence}
          defaultCaption={issueEvidenceCaption(issue)}
          empty="Drop or pick pictures of the completed work."
        />
    </ModalSheet>
  );
}

function IssuePhotoBank({
  projectId,
  code,
  kind,
  photos,
  empty,
  defaultCaption,
}: {
  projectId: string;
  code: string;
  kind: "problem" | "evidence";
  photos: IssuePhoto[];
  empty: string;
  defaultCaption?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [inspect, setInspect] = useState<number | null>(null);

  async function add(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    try {
      let ok = 0;
      for (const file of files) {
        const dataB64 = await compressImage(file);
        await addIssuePhoto({
          data: {
            projectId,
            code,
            kind,
            dataB64,
            mime: "image/jpeg",
            caption: kind === "evidence" ? defaultCaption : "",
            workDate: todayISO(),
          },
        });
        ok += 1;
      }
      await queryClient.invalidateQueries({ queryKey: ["issue-photos", projectId, code] });
      toast.success(ok === 1 ? "Picture added" : `${ok} pictures added`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add photo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PhotoDrop
      compact
      busy={busy}
      hint="Gallery, camera, or drop files"
      onFiles={(files) => void add(files)}
    >
      {photos.length ? (
        <div className="mb-2 grid grid-cols-2 gap-2">
          {photos.map((ph, i) => (
            <figure key={ph.id} className="relative overflow-hidden rounded-xl bg-line">
              <div className="aspect-square w-full">
                <PhotoThumb
                  photo={{ id: ph.id, mime: ph.mime }}
                  source={ph.fromReport ? "report" : "issue"}
                  onInspect={() => setInspect(i)}
                />
              </div>
              <figcaption className="px-2 py-1">
                <textarea
                  className="min-h-16 w-full resize-y rounded-lg border border-line bg-card px-2 py-1 text-xs text-ink"
                  defaultValue={ph.caption}
                  placeholder={defaultCaption || "Describe this picture"}
                  onBlur={async (e) => {
                    const caption = e.target.value.trim();
                    if (caption === ph.caption) return;
                    if (ph.fromReport || ph.workDate) {
                      await updatePhotoMeta({ data: { id: ph.id, caption, cxalloy: code } });
                    } else {
                      await updateIssuePhoto({ data: { id: ph.id, caption } });
                    }
                    await queryClient.invalidateQueries({
                      queryKey: ["issue-photos", projectId, code],
                    });
                    await queryClient.invalidateQueries({ queryKey: ["photos"] });
                  }}
                />
              </figcaption>
              <button
                type="button"
                className="absolute top-1 right-1 grid size-8 place-items-center rounded-lg bg-navy-3/70 text-card"
                aria-label="Remove photo"
                onClick={async () => {
                  if (ph.fromReport || ph.workDate) await deletePhoto({ data: ph.id });
                  else await deleteIssuePhoto({ data: ph.id });
                  await queryClient.invalidateQueries({
                    queryKey: ["issue-photos", projectId, code],
                  });
                  await queryClient.invalidateQueries({ queryKey: ["photos"] });
                }}
              >
                <X className="size-4" />
              </button>
            </figure>
          ))}
        </div>
      ) : (
        <p className="mb-2 text-sm text-muted">{empty}</p>
      )}
      {inspect !== null ? (
        <PhotoLightbox
          items={photos.map(
            (ph): LightboxItem => ({
              id: ph.id,
              mime: ph.mime,
              caption: ph.caption,
              source: ph.fromReport ? "report" : "issue",
            }),
          )}
          index={inspect}
          onIndex={setInspect}
          onClose={() => setInspect(null)}
        />
      ) : null}
    </PhotoDrop>
  );
}

function Stat({
  n,
  l,
  active,
  onClick,
}: {
  n: string;
  l: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl p-3 text-center shadow-card ${
        active ? "bg-navy text-card" : "bg-card text-navy"
      }`}
    >
      <div className={`text-lg font-bold tabular-nums ${active ? "text-card" : "text-navy"}`}>{n}</div>
      <div className={`text-xs tracking-wider uppercase ${active ? "text-card/70" : "text-muted"}`}>{l}</div>
    </button>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { SignInGate, RedirectToSignIn } from "@/lib/auth/gates";
import {
  addIssuePhoto,
  addPhoto,
  deletePhoto,
  deleteReport,
  getExportBundle,
  getProject,
  getReport,
  listIssues,
  listPeople,
  listPhotos,
  listRoster,
  savePerson,
  saveReport,
  updatePhotoMeta,
  upsertIssueFromPunch,
} from "@/lib/dsr/api";
import { polishDay } from "@/lib/dsr/ai";
import {
  QUICK_PUNCHES,
  type PhotoMeta,
  type Report,
  type TimelineEntry,
} from "@/lib/dsr/types";
import { buildOfficialPdf, downloadBlob, pdfFilename } from "@/lib/dsr/pdf";
import { chainEntries, durationLabel, emptyPunch, minutesBetween, nextFreeTime } from "@/lib/dsr/timeline";
import {
  entryClosedCodes,
  entryIssueCodes,
  issueEvidenceCaption,
  photoCaptionLabel,
} from "@/lib/dsr/cxalloy";
import { fmtDateDots, makeReportNo, namesFromCrew, normalizeHhmm } from "@/lib/utils";
import { compressImage } from "@/lib/dsr/image";
import { queryClient } from "@/lib/query";
import { AppShell, FormGrid, ModalSheet, Panel, SectionLabel } from "@/components/dsr/shell";
import { ListRow, PickSheet, PickTrigger } from "@/components/dsr/pick-list";
import { PunchSheet, type PunchExtra } from "@/components/dsr/punch-sheet";
import { IssuePicker } from "@/components/dsr/issue-picker";
import { PhotoDrop } from "@/components/dsr/photo-drop";
import { PhotoThumb } from "@/components/dsr/photo-thumb";
import { PhotoLightbox } from "@/components/dsr/photo-lightbox";
import { Button } from "@/components/ui/button";
import { Field, HhmmInput, Input, Textarea } from "@/components/ui/field";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { readUnsyncedDraft, writeReportDraft } from "@/lib/dsr/draft";

export const Route = createFileRoute("/project/$projectId/report/$reportId")({
  component: ReportPage,
});

function ReportPage() {
  const { projectId, reportId } = Route.useParams();
  return (
    <SignInGate fallback={<RedirectToSignIn />}>
      <Editor projectId={projectId} reportId={reportId} />
    </SignInGate>
  );
}

function Editor({ projectId, reportId }: { projectId: string; reportId: string }) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const projectQ = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject({ data: projectId }),
  });
  const reportQ = useQuery({
    queryKey: ["report", reportId],
    queryFn: () => getReport({ data: reportId }),
  });
  const photosQ = useQuery({
    queryKey: ["photos", reportId],
    queryFn: () => listPhotos({ data: reportId }),
  });
  const peopleQ = useQuery({
    queryKey: ["people", projectId],
    queryFn: () => listPeople({ data: projectId }),
  });
  const rosterQ = useQuery({ queryKey: ["roster"], queryFn: () => listRoster() });
  const issuesQ = useQuery({
    queryKey: ["issues", projectId],
    queryFn: () => listIssues({ data: { projectId } }),
  });

  const [draft, setDraft] = useState<Report | null>(null);
  const [tag, setTag] = useState<PhotoMeta | null>(null);
  const [inspect, setInspect] = useState<number | null>(null);
  const [punch, setPunch] = useState<Partial<TimelineEntry> | true | null>(null);
  const [crewOpen, setCrewOpen] = useState(false);
  const [punchMenu, setPunchMenu] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [polishBusy, setPolishBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "offline">("saved");
  const dirtyRef = useRef(false);
  const draftRef = useRef<Report | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef("");
  const persistRef = useRef<(next?: Report) => Promise<Report | null | undefined>>(async () => undefined);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    const server = reportQ.data;
    if (!server) return;
    setDraft((current) => {
      if (current && current.id === server.id && dirtyRef.current) return current;
      const local = readUnsyncedDraft(server.id);
      if (local && local.id === server.id) {
        dirtyRef.current = true;
        setTimeout(() => void persistRef.current(local), 400);
        return local;
      }
      lastSaved.current = JSON.stringify(server);
      return server;
    });
  }, [reportQ.data]);

  const saveMut = useMutation({
    mutationFn: (r: Report) => saveReport({ data: r }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report", reportId] });
      queryClient.invalidateQueries({ queryKey: ["reports", projectId] });
    },
  });

  const people = peopleQ.data ?? [];
  const issues = issuesQ.data ?? [];
  const roster = people.filter((p) => p.active).map((p) => p.name);
  const chained = useMemo(
    () => chainEntries(draft?.entries || [], draft?.timeOff || ""),
    [draft?.entries, draft?.timeOff],
  );

  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current && draftRef.current) void persistRef.current(draftRef.current);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
      else if (dirtyRef.current && draftRef.current) void persistRef.current(draftRef.current);
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  if (!draft || !projectQ.data) {
    return (
      <AppShell title="Daily report" backTo={`/project/${projectId}`} jobId={projectId}>
        <div className="h-64 animate-pulse rounded-xl bg-card" />
      </AppShell>
    );
  }

  const p = projectQ.data;
  const photos = photosQ.data ?? [];
  const report = draft;
  const pool = Array.from(
    new Set(
      [
        ...(rosterQ.data ?? []).map((r) => r.name),
        ...roster,
        ...report.crewToday,
        ...namesFromCrew(p.crew),
        p.technician,
      ].filter(Boolean),
    ),
  );
  const missingPunches = !chained.length;
  const missingTimeOff = !normalizeHhmm(draft.timeOff);

  function patch(partial: Partial<Report>) {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, ...partial };
      scheduleSave(next);
      return next;
    });
  }

  function scheduleSave(r: Report) {
    dirtyRef.current = true;
    writeReportDraft(r, false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(r), 700);
  }

  async function persist(next?: Report) {
    const r = next ?? draftRef.current ?? report;
    if (!r) return r;
    const chainedNext = {
      ...r,
      timeOn: normalizeHhmm(r.timeOn, r.timeOn),
      timeOff: normalizeHhmm(r.timeOff, r.timeOff),
      entries: chainEntries(r.entries || [], normalizeHhmm(r.timeOff, r.timeOff)),
    };
    const key = JSON.stringify(chainedNext);
    if (key === lastSaved.current && !dirtyRef.current) return chainedNext;
    setDraft(chainedNext);
    draftRef.current = chainedNext;
    setSaveState("saving");
    try {
      await saveMut.mutateAsync(chainedNext);
      lastSaved.current = key;
      dirtyRef.current = false;
      writeReportDraft(chainedNext, true);
      setSaveState("saved");
    } catch (e) {
      writeReportDraft(chainedNext, false);
      dirtyRef.current = true;
      setSaveState("offline");
      toast.error(
        e instanceof Error
          ? e.message
          : "Couldn't reach the server. This day is saved on this phone until you're back online.",
      );
    }
    return chainedNext;
  }
  persistRef.current = persist;

  async function applyPunch(entry: TimelineEntry, extra?: PunchExtra) {
    const others = (report.entries || []).filter((e) => e.id !== entry.id);
    const codes = entryIssueCodes(entry);
    const closedCodes = extra?.closedCodes ?? entryClosedCodes(entry);
    const timed: TimelineEntry = {
      ...entry,
      time: nextFreeTime(others, entry.time, entry.workers),
      closed: closedCodes.length > 0,
      closedCodes,
    };
    const next: Report = {
      ...report,
      entries: chainEntries([...others, timed], report.timeOff),
    };
    setDraft(next);
    setPunch(null);
    await persist(next);
    const minutes = minutesBetween(timed.time, timed.endTime || report.timeOff);
    const per = codes.length ? Math.max(1, Math.round(minutes / codes.length)) : minutes;
    let addedPhotos = false;
    for (const code of codes) {
      await upsertIssueFromPunch({
        data: {
          projectId,
          code,
          title: issues.find((i) => i.code === code)?.title || code,
          closed: closedCodes.includes(code),
          closedBy: timed.workers[0] || user?.displayName || p.technician,
          closedAtTime: timed.time,
          minutesSpent: per,
          notes: timed.text,
        },
      });
      const issue = issues.find((i) => i.code === code);
      const caption = issue ? issueEvidenceCaption(issue) : code;
      for (const file of extra?.evidenceByCode?.[code] || []) {
        try {
          const dataB64 = await compressImage(file);
          await addIssuePhoto({
            data: {
              projectId,
              code,
              kind: "evidence",
              dataB64,
              mime: "image/jpeg",
              caption,
              sourceReportId: reportId,
            },
          });
          addedPhotos = true;
        } catch {
          /* keep the punch even if one picture fails */
        }
      }
    }
    if (addedPhotos) {
      await queryClient.invalidateQueries({ queryKey: ["photos", reportId] });
      for (const code of codes) {
        await queryClient.invalidateQueries({ queryKey: ["issue-photos", projectId, code] });
      }
    }
    if (codes.length) {
      await queryClient.invalidateQueries({ queryKey: ["issues", projectId] });
    }
  }

  function toggleCrew(name: string) {
    const on = report.crewToday.includes(name);
    const crewToday = on
      ? report.crewToday.filter((n) => n !== name)
      : [...report.crewToday, name];
    const next = { ...report, crewToday };
    setDraft(next);
    void persist(next);
  }

  async function onPhotos(files: File[]) {
    if (!files.length) return;
    setPhotoBusy(true);
    try {
      let ok = 0;
      for (const file of files) {
        const dataB64 = await compressImage(file);
        await addPhoto({ data: { reportId, dataB64, mime: "image/jpeg" } });
        ok += 1;
      }
      await queryClient.invalidateQueries({ queryKey: ["photos", reportId] });
      toast.success(ok === 1 ? "Picture added" : `${ok} pictures added`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add photo");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function exportPdf(share = false) {
    if (missingPunches || missingTimeOff) {
      if (!confirm("This day is missing punches or time off. Export anyway?")) return;
    }
    setPdfBusy(true);
    try {
      await persist();
      const bundle = await getExportBundle({ data: reportId });
      if (!bundle) throw new Error("Report not found");
      toast.message("Building official PDF…");
      const blob = await buildOfficialPdf(
        bundle.project,
        bundle.report,
        bundle.photos,
        bundle.profile,
      );
      const name = pdfFilename(bundle.project, bundle.report);
      if (share && navigator.share) {
        const file = new File([blob], name, { type: "application/pdf" });
        try {
          await navigator.share({ files: [file], title: name });
          return;
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
        }
      }
      downloadBlob(blob, name);
      toast.success("PDF downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF failed");
    } finally {
      setPdfBusy(false);
    }
  }

  async function polish() {
    setPolishBusy(true);
    try {
      const current = await persist();
      if (!current) return;
      const res = await polishDay({
        data: {
          entries: current.entries,
          comments: current.comments,
          crew: current.crewToday,
          jobTask: p.jobTask,
          issues: issues.map((i) => ({
            code: i.code,
            title: i.title,
            description: i.description,
            status: i.status,
          })),
        },
      });
      const byId = new Map(res.entries.map((e) => [e.id, e.text]));
      if (!byId.size) {
        toast.error(("notice" in res && res.notice) || "Could not polish those lines.");
        return;
      }
      const entries = current.entries.map((e) =>
        byId.has(e.id) ? { ...e, text: byId.get(e.id) || e.text } : e,
      );
      await persist({ ...current, entries, comments: res.comments });
      if (res.usedAi === false) {
        toast.message(res.notice || "Polished from the CXAlloy list. AI writing was unavailable.");
      } else {
        toast.success("Writing polished");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not polish");
    } finally {
      setPolishBusy(false);
    }
  }

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "offline"
        ? "Saved on this phone"
        : "Autosaved";

  return (
    <AppShell
      title={fmtDateDots(draft.workDate)}
      eyebrow={p.customer}
      backTo={`/project/${projectId}`}
      jobId={projectId}
      contentClassName="pb-36 lg:pb-8"
      actions={
        <>
          <span className="text-xs text-muted">{saveLabel}</span>
          <Button variant="cyan" disabled={pdfBusy} onClick={() => void exportPdf(false)}>
            {pdfBusy ? "Building PDF…" : "Export PDF"}
          </Button>
        </>
      }
    >
      {missingPunches || missingTimeOff ? (
        <div className="mb-4 rounded-lg bg-card px-4 py-3 text-sm text-ink shadow-card">
          {missingPunches
            ? "This day has no hour punches yet. Add arrive / work before you export."
            : "Time off is empty. Fill it so the last task has an end time on the PDF."}
        </div>
      ) : null}

      <Panel className="mb-6">
        <FormGrid wide>
          <Field label="Date">
            <Input
              type="date"
              value={draft.workDate}
              onChange={(e) => {
                const workDate = e.target.value;
                patch({ workDate, reportNo: makeReportNo(workDate, p.initials) });
              }}
            />
          </Field>
          <Field label="Report No.">
            <Input value={draft.reportNo} onChange={(e) => patch({ reportNo: e.target.value })} />
          </Field>
          <Field label="Time on">
            <HhmmInput value={draft.timeOn} onChange={(timeOn) => patch({ timeOn })} />
          </Field>
          <Field label="Time off">
            <HhmmInput
              value={draft.timeOff}
              onChange={(timeOff) => patch({ timeOff })}
              onBlur={() => void persist()}
            />
          </Field>
        </FormGrid>
      </Panel>

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-12">
        <div className="min-w-0 space-y-6 xl:col-span-7">
          <div>
            <SectionLabel>Crew on site today</SectionLabel>
            <Panel className="p-3 sm:p-4">
              <PickTrigger
                summary={report.crewToday.join(", ")}
                empty="Tap to pick who is on site"
                count={report.crewToday.length}
                onClick={() => setCrewOpen(true)}
              />
            </Panel>
          </div>

          <div>
            <SectionLabel
              action={
                <Link
                  to="/project/$projectId/issues"
                  params={{ projectId }}
                  className="text-xs font-semibold text-cyan-2"
                >
                  CXAlloy list
                </Link>
              }
            >
              Hour punches
            </SectionLabel>
            <Panel className="mb-2 p-3 sm:p-4">
              <PickTrigger
                summary=""
                empty="Add a punch"
                onClick={() => setPunchMenu(true)}
              />
            </Panel>
            <Panel className="p-0 sm:p-0">
              {chained.length ? (
                chained.map((e) => (
                  <div
                    key={e.id}
                    className="border-b border-line px-3 py-3 last:border-0 sm:px-4"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setPunch(e)}
                      >
                        <div className="font-bold tabular-nums text-navy">
                          {e.time}
                          {e.endTime ? `–${e.endTime}` : ""}
                          <span className="ml-2 text-xs font-semibold text-muted">
                            {durationLabel(e.time, e.endTime) || "open"}
                          </span>
                        </div>
                        <div className="mt-1 flex min-w-0 flex-wrap gap-1">
                          {e.kind === "standby" ? (
                            <span className="rounded-full bg-paper px-1.5 py-0.5 text-xs font-bold tracking-wide text-muted uppercase">
                              Standby
                            </span>
                          ) : null}
                          {entryIssueCodes(e).map((code) => (
                            <span
                              key={code}
                              className="rounded-full bg-navy/10 px-1.5 py-0.5 text-xs font-bold text-navy"
                            >
                              {code}
                              {entryClosedCodes(e).includes(code) ? " · closed" : ""}
                            </span>
                          ))}
                        </div>
                        <p className="mt-1 line-clamp-3 text-sm break-words text-ink">
                          {e.text || "Tap to edit"}
                        </p>
                        {e.workers.length ? (
                          <p className="mt-0.5 truncate text-xs text-muted">{e.workers.join(", ")}</p>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className="grid size-11 shrink-0 place-items-center rounded-lg bg-paper text-muted"
                        aria-label="Remove punch"
                        onClick={() => {
                          const next = {
                            ...report,
                            entries: report.entries.filter((x) => x.id !== e.id),
                          };
                          setDraft(next);
                          void persist(next);
                        }}
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="px-4 py-8 text-center text-sm text-muted">
                  Add a punch to start the day. The next punch closes this one.
                </p>
              )}
            </Panel>
          </div>
        </div>

        <div className="min-w-0 space-y-6 xl:col-span-5">
          <div>
            <SectionLabel>Pictures</SectionLabel>
            <PhotoDrop
              busy={photoBusy}
              hint="Pick from the gallery, take a photo, or drop files from your computer"
              onFiles={(files) => void onPhotos(files)}
            >
              {photos.length ? (
                <div className="mb-2 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
                  {photos.map((ph, i) => (
                    <div key={ph.id} className="relative min-w-0 aspect-[3/4] overflow-hidden rounded-lg bg-line">
                      <PhotoThumb photo={ph} onInspect={() => setInspect(i)} />
                      <button
                        type="button"
                        className="absolute top-1.5 right-1.5 grid size-11 place-items-center rounded-lg bg-navy-3/70 text-card"
                        onClick={async () => {
                          await deletePhoto({ data: ph.id });
                          await queryClient.invalidateQueries({ queryKey: ["photos", reportId] });
                        }}
                        aria-label="Remove photo"
                      >
                        <X className="size-4" />
                      </button>
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-navy-3/80 to-transparent px-2 pt-6 pb-2 text-left text-xs text-card">
                        <span className="line-clamp-2">
                          {photoCaptionLabel(ph.cxalloy, ph.caption) || "Tap to examine"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mb-2 px-2 text-center text-sm text-muted">
                  No pictures on this day yet. Add as many as you need.
                </p>
              )}
            </PhotoDrop>
          </div>

          <div>
            <SectionLabel>Close-out</SectionLabel>
            <Panel>
              <FormGrid>
                <Field label="Material used" className="dsr-span-all">
                  <Input
                    value={draft.materialUsed}
                    onChange={(e) => patch({ materialUsed: e.target.value })}
                  />
                </Field>
                <Field label="Parts needed / delivery" className="dsr-span-all">
                  <Input
                    value={draft.partsNeededText}
                    onChange={(e) => patch({ partsNeededText: e.target.value })}
                  />
                </Field>
                <Field label="Estimated cost">
                  <Input
                    value={draft.estimatedCost}
                    onChange={(e) => patch({ estimatedCost: e.target.value })}
                  />
                </Field>
                <Field label="Mileage (round trip)">
                  <Input value={draft.mileage} onChange={(e) => patch({ mileage: e.target.value })} />
                </Field>
                <Field label="Comments" className="dsr-span-all">
                  <Textarea
                    value={draft.comments}
                    onChange={(e) => patch({ comments: e.target.value })}
                  />
                </Field>
              </FormGrid>
              <div className="mt-3 grid gap-2">
                {(
                  [
                    ["jobComplete", "Job complete"],
                    ["partsNeeded", "Parts needed"],
                    ["drawingsNeeded", "Drawings needed"],
                    ["returnCallNeeded", "Return call needed"],
                    ["rentalNeeded", "Rental equipment needed"],
                  ] as const
                ).map(([k, label]) => (
                  <label
                    key={k}
                    className="flex min-h-11 items-center gap-3 rounded-lg bg-paper px-3 text-sm font-medium"
                  >
                    <input
                      type="checkbox"
                      className="size-5 accent-navy"
                      checked={!!draft[k]}
                      onChange={(e) => patch({ [k]: e.target.checked })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </Panel>
          </div>

          <div className="hidden flex-col gap-2 lg:flex">
            <p className="text-xs text-muted">{saveLabel}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                width="full"
                onClick={async () => {
                  await persist();
                  if (dirtyRef.current) return;
                  toast.success("Day saved");
                }}
              >
                Save day
              </Button>
              <Button width="full" variant="cyan" disabled={pdfBusy} onClick={() => void exportPdf(false)}>
                {pdfBusy ? "Building PDF…" : "Export official PDF"}
              </Button>
              <Button width="full" variant="ghost" disabled={polishBusy} onClick={() => void polish()}>
                {polishBusy ? "Polishing…" : "Fix grammar"}
              </Button>
              <Button width="full" variant="ghost" disabled={pdfBusy} onClick={() => void exportPdf(true)}>
                Share PDF
              </Button>
            </div>
            <Button
              width="full"
              variant="danger"
              onClick={async () => {
                if (!confirm(`Delete the ${fmtDateDots(draft.workDate)} report? This cannot be undone.`)) return;
                try {
                  await deleteReport({ data: reportId });
                  await queryClient.invalidateQueries({ queryKey: ["reports", projectId] });
                  await queryClient.invalidateQueries({ queryKey: ["projects"] });
                  toast.success("Report deleted");
                  navigate({ to: "/project/$projectId", params: { projectId } });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Could not delete");
                }
              }}
            >
              Delete this report
            </Button>
          </div>
        </div>
      </div>

      <div className="dsr-gutter fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-20 border-t border-line bg-card/95 py-2 backdrop-blur lg:hidden">
        <div className="mx-auto flex min-w-0 max-w-6xl items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-muted">{saveLabel}</p>
          <Button
            className="shrink-0 px-3"
            onClick={async () => {
              await persist();
              if (dirtyRef.current) return;
              toast.success("Day saved");
            }}
          >
            Save
          </Button>
          <Button className="shrink-0 px-3" variant="cyan" disabled={pdfBusy} onClick={() => void exportPdf(false)}>
            {pdfBusy ? "PDF…" : "PDF"}
          </Button>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 lg:hidden">
        <Button width="full" variant="ghost" disabled={polishBusy} onClick={() => void polish()}>
          {polishBusy ? "Polishing…" : "Fix grammar & flesh out lines"}
        </Button>
        <Button width="full" variant="ghost" disabled={pdfBusy} onClick={() => void exportPdf(true)}>
          Share PDF
        </Button>
        <Button
          width="full"
          variant="danger"
          onClick={async () => {
            if (!confirm(`Delete the ${fmtDateDots(draft.workDate)} report? This cannot be undone.`)) return;
            try {
              await deleteReport({ data: reportId });
              await queryClient.invalidateQueries({ queryKey: ["reports", projectId] });
              await queryClient.invalidateQueries({ queryKey: ["projects"] });
              toast.success("Report deleted");
              navigate({ to: "/project/$projectId", params: { projectId } });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not delete");
            }
          }}
        >
          Delete this report
        </Button>
      </div>

      {crewOpen ? (
        <PickSheet title="Crew on site today" onClose={() => setCrewOpen(false)}>
          {pool.length ? (
            pool.map((n) => (
              <ListRow key={n} selected={report.crewToday.includes(n)} onClick={() => toggleCrew(n)}>
                {n}
              </ListRow>
            ))
          ) : (
            <p className="py-4 text-sm text-muted">No names yet. Add someone below.</p>
          )}
          <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Add someone for today"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                const name = newName.trim();
                if (!name) return;
                await savePerson({ data: { projectId, name } });
                await queryClient.invalidateQueries({ queryKey: ["people", projectId] });
                const crewToday = [...report.crewToday, name];
                patch({ crewToday });
                setNewName("");
              }}
            >
              Add
            </Button>
          </div>
        </PickSheet>
      ) : null}

      {punchMenu ? (
        <PickSheet title="Add a punch" onClose={() => setPunchMenu(false)}>
          {QUICK_PUNCHES.map((q) => (
            <ListRow
              key={q.label}
              hint={q.text}
              onClick={() => {
                setPunchMenu(false);
                void applyPunch(
                  emptyPunch({
                    text: q.text,
                    kind: q.kind,
                    workers: report.crewToday,
                  }),
                );
              }}
            >
              {q.label}
            </ListRow>
          ))}
          <ListRow
            onClick={() => {
              setPunchMenu(false);
              setPunch(true);
            }}
          >
            Work punch
          </ListRow>
          <ListRow
            onClick={() => {
              setPunchMenu(false);
              setPunch({ kind: "standby", workers: report.crewToday });
            }}
          >
            Standby
          </ListRow>
        </PickSheet>
      ) : null}

      {punch ? (
        <PunchSheet
          crew={report.crewToday.length ? report.crewToday : pool}
          issues={issues}
          initial={punch === true ? { workers: report.crewToday } : punch}
          onClose={() => setPunch(null)}
          onSave={(entry, extra) => void applyPunch(entry, extra)}
        />
      ) : null}

      {inspect !== null ? (
        <PhotoLightbox
          items={photos.map((ph) => ({
            id: ph.id,
            mime: ph.mime,
            caption: photoCaptionLabel(ph.cxalloy, ph.caption),
            source: "report" as const,
          }))}
          index={inspect}
          onIndex={setInspect}
          onClose={() => setInspect(null)}
          extra={
            <Button
              width="full"
              variant="outline"
              onClick={() => {
                const ph = photos[inspect];
                if (!ph) return;
                setInspect(null);
                setTag(ph);
              }}
            >
              Tag CXAlloy issue
            </Button>
          }
        />
      ) : null}

      {tag ? (
        <ModalSheet onClose={() => setTag(null)} wide>
          <IssuePicker
            issues={issues}
            value={tag.cxalloy}
            onChange={(code) => {
              const issue = issues.find((i) => i.code === code);
              const caption = issue ? issueEvidenceCaption(issue) : tag.caption;
              setTag({ ...tag, cxalloy: code, caption });
            }}
            onClose={() => setTag(null)}
          />
          <Field label="Caption" className="mt-3">
            <Textarea value={tag.caption} onChange={(e) => setTag({ ...tag, caption: e.target.value })} />
          </Field>
          <Button
            className="mt-3"
            width="full"
            onClick={async () => {
              await updatePhotoMeta({
                data: { id: tag.id, caption: tag.caption, cxalloy: tag.cxalloy },
              });
              await queryClient.invalidateQueries({ queryKey: ["photos", reportId] });
              setTag(null);
            }}
          >
            Save tag
          </Button>
        </ModalSheet>
      ) : null}
    </AppShell>
  );
}

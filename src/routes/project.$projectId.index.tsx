import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { deleteReport, getProject, listReports, openDayReport } from "@/lib/dsr/api";
import { setLastProjectId } from "@/lib/last-project";
import { niceDate, todayISO } from "@/lib/utils";
import { AppShell, Panel, SectionLabel } from "@/components/dsr/shell";
import { Button } from "@/components/ui/button";
import { FileDrop } from "@/components/dsr/file-drop";
import { DateConflictReview } from "@/components/dsr/date-conflict-review";
import { bulkImportDsrs, type BulkProgress, type DateConflict } from "@/lib/dsr/bulk-import";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { queryClient } from "@/lib/query";

export const Route = createFileRoute("/project/$projectId/")({
  component: ProjectHome,
});

function ProjectHome() {
  const { projectId: id } = Route.useParams();
  const navigate = useNavigate();
  useEffect(() => setLastProjectId(id), [id]);
  const projectQ = useQuery({ queryKey: ["project", id], queryFn: () => getProject({ data: id }) });
  const reportsQ = useQuery({
    queryKey: ["reports", id],
    queryFn: () => listReports({ data: id }),
  });
  const p = projectQ.data;
  const reports = reportsQ.data ?? [];
  const month = todayISO().slice(0, 7);
  const thisMonth = reports.filter((r) => r.workDate.startsWith(month)).length;
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [conflicts, setConflicts] = useState<DateConflict[]>([]);

  async function onImport(input: FileList | DataTransfer) {
    setImporting(true);
    setProgress({
      done: 0,
      total: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      jobs: 0,
      photos: 0,
      needsDate: 0,
      current: "",
    });
    try {
      const res = await bulkImportDsrs({
        projectId: id,
        input,
        existingDates: reports.map((r) => r.workDate),
        onProgress: setProgress,
      });
      if (res.conflicts.length) setConflicts(res.conflicts);
      else if (res.imported === 1 && res.lastId && res.skipped === 0 && res.failed === 0) {
        navigate({
          to: "/project/$projectId/report/$reportId",
          params: { projectId: id, reportId: res.lastId },
        });
      }
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  if (projectQ.isLoading) {
    return (
      <AppShell title="Loading…" backTo="/">
        <div className="h-40 animate-pulse rounded-xl bg-card" />
      </AppShell>
    );
  }
  if (!p) {
    return (
      <AppShell title="Not found" backTo="/">
        <p className="text-muted">This project is not on your account.</p>
      </AppShell>
    );
  }

  return (
    <AppShell title={p.name || p.customer} eyebrow="Job" backTo="/" jobId={id}>
        <div className="mb-5 grid grid-cols-3 gap-2 sm:gap-3">
          <Stat n={String(reports.length)} l="Reports" />
          <Stat n={String(thisMonth)} l="This month" />
          <Stat n={p.wo || "—"} l="WO" />
        </div>
        <div className="mb-5 flex flex-wrap gap-2">
          <Button
            onClick={async () => {
              try {
                const report = await openDayReport({
                  data: { projectId: id, workDate: todayISO() },
                });
                navigate({
                  to: "/project/$projectId/report/$reportId",
                  params: { projectId: id, reportId: report.id },
                });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not open today's report");
              }
            }}
          >
            <span className="sm:hidden">Today</span>
            <span className="hidden sm:inline">Today’s report</span>
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              navigate({ to: "/project/$projectId/edit", params: { projectId: id } })
            }
          >
            Job details
          </Button>
          <Button
            variant="cyan"
            onClick={() =>
              navigate({ to: "/project/$projectId/export", params: { projectId: id } })
            }
          >
            Export
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              navigate({ to: "/project/$projectId/issues", params: { projectId: id } })
            }
          >
            <span className="sm:hidden">Issues</span>
            <span className="hidden sm:inline">CXAlloy issues</span>
          </Button>
        </div>
        <div className="mb-4">
          <FileDrop
            accept="application/pdf,.pdf,application/zip,.zip"
            busy={importing}
            progress={progress}
            label="Import daily reports"
            shortLabel="Import PDFs"
            hint="Drop PDFs, a folder, or a ZIP of a month or year. Duplicate days are skipped."
            onInput={(input) => void onImport(input)}
          />
        </div>
        <SectionLabel>Daily reports</SectionLabel>
        <Panel className="p-0 sm:p-0">
          {reports.length ? (
            reports.map((r) => (
              <div
                key={r.id}
                className="flex w-full items-center gap-2 border-b border-line px-2 py-2 last:border-0"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1 text-left"
                  onClick={() =>
                    navigate({
                      to: "/project/$projectId/report/$reportId",
                      params: { projectId: id, reportId: r.id },
                    })
                  }
                >
                  <span className="size-2.5 rounded-full bg-cyan" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{niceDate(r.workDate)}</div>
                    <div className="truncate text-sm text-muted">
                      {r.entryCount} entries · {r.photoCount} photos · {r.reportNo}
                    </div>
                  </div>
                  <span className="text-xs text-muted">Edit</span>
                </button>
                <button
                  type="button"
                  className="grid size-10 shrink-0 place-items-center rounded-lg text-muted"
                  aria-label="Delete report"
                  onClick={async () => {
                    if (!confirm(`Delete the ${niceDate(r.workDate)} report? This cannot be undone.`)) return;
                    try {
                      await deleteReport({ data: r.id });
                      await queryClient.invalidateQueries({ queryKey: ["reports", id] });
                      await queryClient.invalidateQueries({ queryKey: ["projects"] });
                      toast.success("Report deleted");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Could not delete");
                    }
                  }}
                >
                  <X className="size-4" />
                </button>
              </div>
            ))
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted">
              No daily reports on this job yet. Open today’s report, or import an official DSR PDF.
            </p>
          )}
        </Panel>
      {conflicts.length ? (
        <DateConflictReview items={conflicts} projectId={id} onClose={() => setConflicts([])} />
      ) : null}
    </AppShell>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div className="rounded-xl bg-card p-3 text-center shadow-card sm:p-4">
      <div className="text-lg font-bold text-navy">{n}</div>
      <div className="text-xs tracking-wider text-muted uppercase">{l}</div>
    </div>
  );
}

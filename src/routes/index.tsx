import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { deleteProject, listProjects, openDayReport } from "@/lib/dsr/api";
import { clearLastProjectId, getLastProjectId, setLastProjectId } from "@/lib/last-project";
import { niceDate, todayISO } from "@/lib/utils";
import { AppShell, AuthSplit, Panel } from "@/components/dsr/shell";
import { DsrMark } from "@/components/dsr/brand";
import { Button } from "@/components/ui/button";
import { FileDrop } from "@/components/dsr/file-drop";
import { DateConflictReview } from "@/components/dsr/date-conflict-review";
import { bulkImportDsrs, type BulkProgress, type DateConflict } from "@/lib/dsr/bulk-import";
import { queryClient } from "@/lib/query";
import { GROK_PROVIDERS, signIn } from "@/lib/auth/client";
import { useState } from "react";
import { toast } from "sonner";
import { isUnauthorized } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <BootScreen />;
  if (!user) return <Welcome />;
  return <ProjectList />;
}

function BootScreen() {
  return (
    <main className="grid min-h-dvh place-items-center bg-navy-3 px-4">
      <div className="text-center">
        <DsrMark className="mx-auto mb-5 size-14 text-base" />
        <p className="text-xs tracking-widest text-cyan uppercase">Field reports</p>
        <p className="mt-2 text-lg font-semibold text-card">DSR Field</p>
        <div className="mx-auto mt-6 h-1.5 w-28 overflow-hidden rounded-full bg-card/15">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-cyan" />
        </div>
      </div>
    </main>
  );
}

function Welcome() {
  return (
    <AuthSplit mobileTone="navy">
      <div className="text-center text-card md:text-left md:text-ink">
        <DsrMark className="mx-auto mb-6 size-14 text-base md:hidden" />
        <p className="text-xs tracking-widest text-cyan uppercase md:text-cyan-2">Field reports</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-navy">DSR Field</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-card/75 md:mx-0 md:text-muted">
          Save a job once. Every day after that is the timeline and photos — then the official PDF,
          from any phone or laptop.
        </p>
        <div className="mx-auto mt-8 flex w-full max-w-xs flex-col gap-2 md:mx-0 md:max-w-none">
          {GROK_PROVIDERS.map((p) => (
            <Button
              key={p.providerId}
              type="button"
              variant="cyan"
              width="full"
              onClick={() => signIn(p.providerId, { callbackURL: "/" })}
            >
              Continue with {p.label}
            </Button>
          ))}
          <a
            href="/login"
            className="mt-1 text-sm text-card/70 underline-offset-4 hover:underline md:text-cyan-2"
          >
            Sign in with email
          </a>
        </div>
      </div>
    </AuthSplit>
  );
}

function ProjectList() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["projects"], queryFn: () => listProjects() });
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
        input,
        onProgress: setProgress,
      });
      if (res.lastProjectId) setLastProjectId(res.lastProjectId);
      if (res.conflicts.length) setConflicts(res.conflicts);
      else if (res.imported === 1 && res.lastId && res.lastProjectId && !res.skipped && !res.failed) {
        navigate({
          to: "/project/$projectId/report/$reportId",
          params: { projectId: res.lastProjectId, reportId: res.lastId },
        });
      }
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  async function removeJob(projectId: string, name: string) {
    if (!confirm(`Delete “${name}” and every daily report on it? This cannot be undone.`)) return;
    try {
      await deleteProject({ data: projectId });
      if (getLastProjectId() === projectId) clearLastProjectId();
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Job deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete job");
    }
  }

  async function openToday(projectId: string) {
    setLastProjectId(projectId);
    try {
      const report = await openDayReport({ data: { projectId, workDate: todayISO() } });
      navigate({
        to: "/project/$projectId/report/$reportId",
        params: { projectId, reportId: report.id },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open today's report");
    }
  }

  if (q.isError) {
    if (isUnauthorized(q.error)) return <RedirectToSignIn />;
    return (
      <AppShell title="Jobs">
        <Panel className="px-5 py-10 text-center">
          <h2 className="text-lg font-semibold text-ink">Couldn't load jobs</h2>
          <p className="mt-1 text-sm text-muted">
            {q.error instanceof Error ? q.error.message : "Network error. Check the connection and try again."}
          </p>
          <Button className="mt-5" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </Panel>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Jobs"
      actions={
        <Button type="button" variant="cyan" onClick={() => navigate({ to: "/new" })}>
          <Plus className="size-4" /> New job
        </Button>
      }
    >
      <div className="mb-6 hidden lg:block">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">Your jobs</h2>
        <p className="mt-1 text-sm text-muted">
          Open a job, start today’s report, or import a year of official DSRs.
        </p>
      </div>
      <div className="mb-5">
        <FileDrop
          accept="application/pdf,.pdf,application/zip,.zip"
          busy={importing}
          progress={progress}
          label="Import a year of reports"
          shortLabel="Import PDFs"
          hint="Drop PDFs, folders, or a ZIP. Pictures load after the days are saved. If a file name and the form disagree, you’ll pick the date with the original PDF open."
          onInput={(input) => void onImport(input)}
        />
      </div>
      <p className="mb-3 text-xs font-semibold tracking-widest text-muted uppercase lg:hidden">
        Your jobs
      </p>
      {q.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="h-28 animate-pulse rounded-xl bg-card" />
          <div className="h-28 animate-pulse rounded-xl bg-card" />
        </div>
      ) : q.data?.length ? (
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {q.data.map((p) => (
            <div key={p.id} className="dsr-card flex w-full min-w-0 items-center gap-3 rounded-xl bg-card p-3 shadow-card">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => {
                  setLastProjectId(p.id);
                  navigate({ to: "/project/$projectId", params: { projectId: p.id } });
                }}
              >
                <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-navy text-sm font-bold text-card">
                  {(p.customer || p.name || "P").slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-ink">{p.name || p.customer}</div>
                  <div className="truncate text-sm text-muted">
                    WO {p.wo || "—"} · {p.location || "No location"}
                  </div>
                  <div className="text-xs text-muted">
                    {p.reportCount || 0} report{(p.reportCount || 0) === 1 ? "" : "s"}
                    {p.lastWorkDate ? ` · last ${niceDate(p.lastWorkDate)}` : ""}
                  </div>
                </div>
              </button>
              <div className="flex shrink-0 flex-col gap-1.5">
                <Button type="button" variant="cyan" className="px-3" onClick={() => void openToday(p.id)}>
                  Today
                </Button>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold text-muted"
                  onClick={() => void removeJob(p.id, p.name || p.customer || "this job")}
                >
                  <Trash2 className="size-3.5" />
                  <span className="hidden sm:inline">Delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Panel className="px-5 py-10 text-center">
          <h2 className="text-lg font-semibold text-ink">No jobs yet</h2>
          <p className="mt-1 text-sm text-muted">
            Import a pile of official DSRs and jobs are created from the WO and customer on each
            report. Or start a blank job.
          </p>
          <Button className="mt-5" onClick={() => navigate({ to: "/new" })}>
            New job
          </Button>
        </Panel>
      )}
      <button
        type="button"
        className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 flex h-14 items-center gap-2 rounded-full bg-cyan px-5 font-semibold text-card shadow-lift lg:hidden"
        onClick={() => navigate({ to: "/new" })}
      >
        <Plus className="size-5" /> New job
      </button>
      {conflicts.length ? (
        <DateConflictReview items={conflicts} onClose={() => setConflicts([])} />
      ) : null}
    </AppShell>
  );
}

export { todayISO, openDayReport };

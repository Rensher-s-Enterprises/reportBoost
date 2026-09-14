import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import JSZip from "jszip";
import { SignInGate, RedirectToSignIn } from "@/lib/auth/gates";
import { getCxalloyExportBundle, getExportBundle, getProject, listReports, listReportsInRange } from "@/lib/dsr/api";
import { buildOfficialPdf, downloadBlob, pdfFilename } from "@/lib/dsr/pdf";
import { buildCxalloyPdf, cxalloyPdfFilename } from "@/lib/dsr/cxalloy-pdf";
import { bulkImportDsrs, type BulkProgress } from "@/lib/dsr/bulk-import";
import { niceDate, todayISO } from "@/lib/utils";
import { AppShell, Panel, SectionLabel } from "@/components/dsr/shell";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FileDrop } from "@/components/dsr/file-drop";

export const Route = createFileRoute("/project/$projectId/export")({ component: ExportPage });

function weekAgoISO() {
  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - 6);
  const z = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return z(from);
}

function monthStartISO() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function ExportPage() {
  const { projectId } = Route.useParams();
  return (
    <SignInGate fallback={<RedirectToSignIn />}>
      <Inner id={projectId} />
    </SignInGate>
  );
}

function Inner({ id }: { id: string }) {
  const navigate = useNavigate();
  const [from, setFrom] = useState(weekAgoISO);
  const [to, setTo] = useState(todayISO);
  const [busy, setBusy] = useState(false);
  const [cxBusy, setCxBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const pQ = useQuery({ queryKey: ["project", id], queryFn: () => getProject({ data: id }) });
  const rQ = useQuery({ queryKey: ["reports", id], queryFn: () => listReports({ data: id }) });
  const p = pQ.data;
  const reports = rQ.data ?? [];

  const monthStart = useMemo(() => monthStartISO(), []);

  async function zipRange() {
    setBusy(true);
    try {
      const ids = await listReportsInRange({ data: { projectId: id, from, to } });
      if (!ids.length) {
        toast.message("No reports in that range");
        return;
      }
      toast.message(`Building ${ids.length} PDFs…`);
      const zip = new JSZip();
      let built = 0;
      let failed = 0;
      for (const rid of ids) {
        try {
          const bundle = await getExportBundle({ data: rid });
          if (!bundle) {
            failed += 1;
            continue;
          }
          const blob = await buildOfficialPdf(
            bundle.project,
            bundle.report,
            bundle.photos,
            bundle.profile,
          );
          zip.file(pdfFilename(bundle.project, bundle.report), blob);
          built += 1;
        } catch {
          failed += 1;
        }
      }
      if (!built) {
        toast.error("Could not build any PDFs in that range");
        return;
      }
      const out = await zip.generateAsync({ type: "blob" });
      const who = (p?.customer || "DSR").replace(/[^\w]+/g, "_").slice(0, 24);
      downloadBlob(out, `DSR_${who}_${from}_to_${to}.zip`);
      toast.success(failed ? `ZIP ready · ${built} PDFs · ${failed} skipped` : "ZIP ready");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  async function weekPack() {
    setBusy(true);
    try {
      const ids = await listReportsInRange({ data: { projectId: id, from, to } });
      if (!ids.length) {
        toast.message("No reports in that range");
        return;
      }
      toast.message("Building the week pack…");
      const zip = new JSZip();
      for (const rid of ids) {
        const bundle = await getExportBundle({ data: rid });
        if (!bundle) continue;
        const blob = await buildOfficialPdf(
          bundle.project,
          bundle.report,
          bundle.photos,
          bundle.profile,
        );
        zip.file(pdfFilename(bundle.project, bundle.report), blob);
      }
      const cx = await getCxalloyExportBundle({ data: id });
      const punched = new Set(
        cx.punches.filter((p) => p.workDate >= from && p.workDate <= to).map((p) => p.code),
      );
      const issues = cx.issues.filter(
        (i) =>
          punched.has(i.code) ||
          i.status === "fixed" ||
          (i.disposition && i.disposition !== "ours"),
      );
      const codes = new Set(issues.map((i) => i.code));
      const cxBlob = await buildCxalloyPdf(
        cx.project,
        issues,
        cx.photos.filter((ph) => codes.has(ph.code)),
        cx.punches.filter((p) => codes.has(p.code)),
      );
      zip.file(`CXAlloy_week_${from}_to_${to}.pdf`, cxBlob);
      const who = (p?.customer || "DSR").replace(/[^\w]+/g, "_").slice(0, 24);
      const out = await zip.generateAsync({ type: "blob" });
      downloadBlob(out, `Week_${who}_${from}_to_${to}.zip`);
      toast.success(`Week pack ready · ${ids.length} days`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Week pack failed");
    } finally {
      setBusy(false);
    }
  }

  async function onePdf(reportId: string) {
    try {
      const bundle = await getExportBundle({ data: reportId });
      if (!bundle) throw new Error("Missing report");
      const blob = await buildOfficialPdf(
        bundle.project,
        bundle.report,
        bundle.photos,
        bundle.profile,
      );
      downloadBlob(blob, pdfFilename(bundle.project, bundle.report));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF failed");
    }
  }

  return (
    <AppShell
        title="Export and share"
        eyebrow={p?.customer || "Job"}
        backTo={`/project/${id}`}
        jobId={id}
      >
        <Panel>
          <p className="mb-3 text-sm text-muted">
            Official one-page form plus photo pages. Same layout as the reports from the field.
          </p>
          <div className="dsr-form-grid">
            <Field label="From">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={() => { setFrom(weekAgoISO()); setTo(todayISO()); }}>
              This week
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setFrom(monthStart);
                setTo(todayISO());
              }}
            >
              This month
            </Button>
          </div>
          <Button className="mt-4" width="full" variant="cyan" disabled={busy} onClick={() => void zipRange()}>
            {busy ? "Building ZIP…" : (
              <>
                <span className="sm:hidden">Download ZIP</span>
                <span className="hidden sm:inline">Download ZIP of this range</span>
              </>
            )}
          </Button>
          <Button
            className="mt-2"
            width="full"
            variant="outline"
            disabled={busy}
            onClick={() => void weekPack()}
          >
            {busy ? "Building week pack…" : (
              <>
                <span className="sm:hidden">Week pack</span>
                <span className="hidden sm:inline">This week’s pack (DSRs + CXAlloy)</span>
              </>
            )}
          </Button>
          <Button
            className="mt-2"
            width="full"
            variant="outline"
            disabled={cxBusy}
            onClick={() => {
              setCxBusy(true);
              toast.message("Building CXAlloy PDF…");
              void getCxalloyExportBundle({ data: id })
                .then(async (bundle) => {
                  const blob = await buildCxalloyPdf(
                    bundle.project,
                    bundle.issues,
                    bundle.photos,
                    bundle.punches,
                  );
                  downloadBlob(blob, cxalloyPdfFilename(bundle.project));
                  const closed = bundle.issues.filter((i) => i.status === "fixed").length;
                  toast.success(
                    `CXAlloy PDF ready · ${closed} closed of ${bundle.issues.length}`,
                  );
                })
                .catch((e) => toast.error(e instanceof Error ? e.message : "CXAlloy export failed"))
                .finally(() => setCxBusy(false));
            }}
          >
            {cxBusy ? "Building CXAlloy…" : (
              <>
                <span className="sm:hidden">CXAlloy pack</span>
                <span className="hidden sm:inline">Download CXAlloy pack (status + repair photos)</span>
              </>
            )}
          </Button>
          <div className="mt-3">
            <FileDrop
              accept="application/pdf,.pdf,application/zip,.zip"
              busy={importing}
              progress={progress}
              label="Import daily reports"
              shortLabel="Import PDFs"
              hint="Drop PDFs, a folder, or a ZIP of a month or year. Duplicate days are skipped."
              onInput={(input) => {
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
                void bulkImportDsrs({
                  projectId: id,
                  input,
                  existingDates: reports.map((r) => r.workDate),
                  onProgress: setProgress,
                }).then((res) => {
                  if (res.imported === 1 && res.lastId && !res.skipped && !res.failed) {
                    navigate({
                      to: "/project/$projectId/report/$reportId",
                      params: { projectId: id, reportId: res.lastId },
                    });
                  }
                }).finally(() => {
                  setImporting(false);
                  setProgress(null);
                });
              }}
            />
          </div>
        </Panel>
        <SectionLabel className="mt-6">{reports.length} reports on this job</SectionLabel>
        <Panel className="p-0 sm:p-0">
          {reports.length ? (
            reports.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0"
              >
                <span className="size-2.5 rounded-full bg-cyan" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{niceDate(r.workDate)}</div>
                  <div className="text-sm text-muted">{r.reportNo}</div>
                </div>
                <Button variant="ghost" onClick={() => void onePdf(r.id)}>
                  PDF
                </Button>
              </div>
            ))
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted">Nothing to export yet.</p>
          )}
        </Panel>
    </AppShell>
  );
}

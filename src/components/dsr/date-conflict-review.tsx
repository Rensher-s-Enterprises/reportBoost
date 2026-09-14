import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { importResolvedDay, type DateConflict } from "@/lib/dsr/bulk-import";
import { fmtDateDots } from "@/lib/utils";
import { queryClient } from "@/lib/query";
import { Button } from "@/components/ui/button";

export function DateConflictReview({
  items,
  projectId,
  onClose,
}: {
  items: DateConflict[];
  projectId?: string;
  onClose: () => void;
}) {
  const [queue, setQueue] = useState(items);
  const current = queue[0];
  const [choice, setChoice] = useState(current?.options[0]?.iso || current?.parsed.workDate || "");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setChoice(current?.options[0]?.iso || current?.parsed.workDate || "");
    setCustom("");
  }, [current?.id]);

  const url = useMemo(() => {
    if (!current) return "";
    return URL.createObjectURL(current.file);
  }, [current]);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  if (!current) return null;

  const picked = custom || choice;
  const name = current.file.name.split("/").pop() || current.file.name;

  async function apply(skip: boolean) {
    if (!current) return;
    if (skip) {
      setQueue((q) => q.slice(1));
      if (queue.length <= 1) onClose();
      return;
    }
    if (!picked) {
      toast.error("Pick a date for this report.");
      return;
    }
    setBusy(true);
    try {
      const res = await importResolvedDay({
        file: current.file,
        parsed: current.parsed,
        workDate: picked,
        projectId,
        folderHint: current.folderHint,
      });
      if (!res.ok) toast.error(res.error);
      else if (res.skipped) toast.message(`${fmtDateDots(picked)} is already on file — skipped`);
      else toast.success(`Saved ${fmtDateDots(picked)}${res.photos ? ` · ${res.photos} pictures` : ""}`);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      if (projectId) await queryClient.invalidateQueries({ queryKey: ["reports", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save that day");
    } finally {
      setBusy(false);
      setQueue((q) => q.slice(1));
      if (queue.length <= 1) onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-3/55 p-0 sm:items-center sm:p-6">
      <div className="flex max-h-[96dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-card shadow-lift sm:rounded-xl">
        <div className="border-b border-line px-4 py-3">
          <p className="text-[11px] font-bold tracking-widest text-muted uppercase">
            Date doesn’t match · {queue.length} left
          </p>
          <h2 className="truncate text-lg font-semibold text-ink">{name}</h2>
          <p className="mt-1 text-sm text-muted">
            The file name and the form don’t agree. Check the original PDF and pick the work day.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {current.file.size < 1_200_000 ? (
            <iframe title="Original report" src={url} className="mb-3 h-64 w-full rounded-xl border border-line bg-paper" />
          ) : (
            <p className="mb-3 rounded-xl border border-line bg-paper px-3 py-4 text-sm text-muted">
              This PDF is large, so it isn’t previewed here. Open it to check the date.
            </p>
          )}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mb-3 inline-block text-sm font-semibold text-navy underline-offset-2 hover:underline"
          >
            Open original PDF
          </a>
          <div className="space-y-2">
            {current.options.map((o) => (
              <label
                key={o.iso + o.label}
                className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3 py-2.5"
              >
                <input
                  type="radio"
                  name="work-date"
                  className="size-4 accent-navy"
                  checked={!custom && choice === o.iso}
                  onChange={() => {
                    setCustom("");
                    setChoice(o.iso);
                  }}
                />
                <span>
                  <span className="font-semibold text-ink">{fmtDateDots(o.iso)}</span>
                  <span className="ml-2 text-sm text-muted">{o.label}</span>
                </span>
              </label>
            ))}
            <label className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3 py-2.5">
              <input
                type="radio"
                name="work-date"
                className="size-4 accent-navy"
                checked={!!custom}
                onChange={() => setCustom(custom || choice || new Date().toISOString().slice(0, 10))}
              />
              <span className="text-sm font-semibold text-ink">Other date</span>
              <input
                type="date"
                className="ml-auto rounded-lg border border-line bg-card px-2 py-1 text-sm"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="flex gap-2 border-t border-line p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
          <Button variant="ghost" width="full" disabled={busy} onClick={() => void apply(true)}>
            Skip
          </Button>
          <Button width="full" disabled={busy || !picked} onClick={() => void apply(false)}>
            {busy ? "Saving…" : "Use this date"}
          </Button>
        </div>
      </div>
    </div>
  );
}

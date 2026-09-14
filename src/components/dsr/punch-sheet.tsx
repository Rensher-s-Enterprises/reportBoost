import { useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, HhmmInput, Input, Textarea } from "@/components/ui/field";
import type { Issue, TimelineEntry, TimelineKind } from "@/lib/dsr/types";
import { STANDBY_REASONS, emptyPunch, nowHHMM } from "@/lib/dsr/timeline";
import { narratePunch } from "@/lib/dsr/ai";
import { IssuePicker } from "@/components/dsr/issue-picker";
import { PhotoDrop } from "@/components/dsr/photo-drop";
import { ModalSheet } from "@/components/dsr/shell";
import { ListRow } from "@/components/dsr/pick-list";
import { cn } from "@/lib/utils";
import {
  entryClosedCodes,
  entryIssueCodes,
  issueEvidenceCaption,
  stampIssueCodes,
} from "@/lib/dsr/cxalloy";

export type PunchExtra = {
  closedCodes: string[];
  evidenceByCode: Record<string, File[]>;
};

export function PunchSheet({
  crew,
  issues,
  initial,
  onClose,
  onSave,
}: {
  crew: string[];
  issues: Issue[];
  initial?: Partial<TimelineEntry>;
  onClose: () => void;
  onSave: (entry: TimelineEntry, extra?: PunchExtra) => void;
}) {
  const [draft, setDraft] = useState<TimelineEntry>(() =>
    emptyPunch({ time: nowHHMM(), workers: crew, ...initial }),
  );
  const [closedCodes, setClosedCodes] = useState<string[]>(() =>
    entryClosedCodes(emptyPunch({ ...initial })),
  );
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(false);
  const [evidenceByCode, setEvidenceByCode] = useState<Record<string, File[]>>({});
  const codes = entryIssueCodes(draft);

  function toggleWorker(name: string) {
    setDraft((d) => ({
      ...d,
      workers: d.workers.includes(name)
        ? d.workers.filter((w) => w !== name)
        : [...d.workers, name],
    }));
  }

  function setKind(kind: TimelineKind) {
    setDraft((d) => ({
      ...d,
      kind,
      ...(kind === "work" ? { standbyReason: "", standbyWhere: "" as const } : {}),
    }));
  }

  function setCodes(next: string[]) {
    const stamped = stampIssueCodes(next);
    setDraft((d) => ({ ...d, ...stamped }));
    setClosedCodes((cur) => cur.filter((c) => stamped.cxalloys.includes(c)));
    setEvidenceByCode((cur) => {
      const keep: Record<string, File[]> = {};
      for (const c of stamped.cxalloys) if (cur[c]?.length) keep[c] = cur[c];
      return keep;
    });
  }

  function toggleCode(code: string) {
    setCodes(codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code]);
  }

  function toggleClosed(code: string) {
    setClosedCodes((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));
  }

  async function writeLine() {
    setBusy(true);
    try {
      const selected = codes
        .map((code) => {
          const issue = issues.find((i) => i.code === code);
          return {
            code,
            title: issue?.title || code,
            description: issue?.description || "",
          };
        });
      const res = await narratePunch({
        data: {
          kind: draft.kind,
          workers: draft.workers,
          issue: selected[0] || null,
          issues: selected,
          closedCodes,
          markFixed: closedCodes.length > 0,
          minutes: 0,
          note: draft.text || draft.standbyNote,
          standbyWhere: draft.standbyWhere,
          standbyReason: draft.standbyReason,
        },
      });
      if (res.ok && res.text) setDraft((d) => ({ ...d, text: res.text }));
      else if (!res.ok) {
        setDraft((d) => ({
          ...d,
          text: d.text || fallbackLine(d, selected, closedCodes, issues),
        }));
        toast.message(res.error || "Wrote a basic line — AI writing was unavailable.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (pick) {
    return (
      <ModalSheet onClose={() => setPick(false)} wide>
        <IssuePicker
          issues={issues}
          multi
          selected={codes}
          onToggle={toggleCode}
          allowNone={false}
          onClose={() => setPick(false)}
        />
      </ModalSheet>
    );
  }

  return (
    <ModalSheet onClose={onClose} wide labelledBy="punch-title">
        <h2 id="punch-title" className="mb-3 text-lg font-semibold">
          {draft.kind === "standby" ? "Standby punch" : "Hour punch"}
        </h2>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            className={cn(
              "min-h-11 rounded-xl text-sm font-semibold",
              draft.kind === "work" ? "bg-navy text-card" : "bg-paper text-navy",
            )}
            onClick={() => setKind("work")}
          >
            Working
          </button>
          <button
            type="button"
            className={cn(
              "min-h-11 rounded-xl text-sm font-semibold",
              draft.kind === "standby" ? "bg-navy text-card" : "bg-paper text-navy",
            )}
            onClick={() => setKind("standby")}
          >
            Standby
          </button>
        </div>
        <div className="space-y-3">
          <Field label="Start time — this ends the previous task">
            <HhmmInput
              value={draft.time}
              onChange={(time) => setDraft({ ...draft, time })}
            />
          </Field>
          <div>
            <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Who</p>
            {crew.length ? (
              crew.map((n) => (
                <ListRow
                  key={n}
                  selected={draft.workers.includes(n)}
                  onClick={() => toggleWorker(n)}
                >
                  {n}
                </ListRow>
              ))
            ) : (
              <p className="text-sm text-muted">Pick today’s crew first.</p>
            )}
          </div>

          {draft.kind === "standby" ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                {(["site", "hotel"] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    className={cn(
                      "min-h-11 rounded-xl text-sm font-semibold",
                      draft.standbyWhere === w ? "bg-navy text-card" : "bg-paper text-navy",
                    )}
                    onClick={() => setDraft({ ...draft, standbyWhere: w })}
                  >
                    {w === "site" ? "On site" : "At hotel"}
                  </button>
                ))}
              </div>
              <div>
                {STANDBY_REASONS.map((r) => (
                  <ListRow
                    key={r.id}
                    selected={draft.standbyReason === r.id}
                    onClick={() => setDraft({ ...draft, standbyReason: r.id })}
                  >
                    {r.label}
                  </ListRow>
                ))}
              </div>
              <Field label="Explain (if other)">
                <Input
                  value={draft.standbyNote}
                  onChange={(e) => setDraft({ ...draft, standbyNote: e.target.value })}
                />
              </Field>
            </>
          ) : (
            <>
              <div>
                <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
                  CXAlloy issues
                </p>
                {codes.length ? (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {codes.map((code) => (
                      <span
                        key={code}
                        className="inline-flex min-h-10 items-center gap-1 rounded-full bg-navy/10 pl-3 text-sm font-semibold text-navy"
                      >
                        {code}
                        {closedCodes.includes(code) ? " · closed" : ""}
                        <button
                          type="button"
                          className="grid size-8 place-items-center rounded-full"
                          aria-label={`Remove ${code}`}
                          onClick={() => toggleCode(code)}
                        >
                          <X className="size-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mb-2 text-sm text-muted">None yet — general work, or add codes.</p>
                )}
                <button
                  type="button"
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-paper px-3 text-sm font-semibold text-navy"
                  onClick={() => setPick(true)}
                >
                  <Plus className="size-4" />
                  Add CXAlloy issue
                </button>
              </div>
              {codes.map((code) => {
                const issue = issues.find((i) => i.code === code);
                const alreadyFixed = issue?.status === "fixed";
                const marked = closedCodes.includes(code) || alreadyFixed;
                const files = evidenceByCode[code] || [];
                return (
                  <div key={code} className="rounded-2xl border border-line bg-paper p-3">
                    <div className="font-semibold text-navy">
                      {issue ? `${issue.code} — ${issue.title}` : `${code} (not imported yet)`}
                    </div>
                    {issue?.description ? (
                      <p className="mt-1 text-sm text-muted">{issue.description}</p>
                    ) : null}
                    {!alreadyFixed ? (
                      <label className="mt-2 flex min-h-11 items-center gap-3 text-sm font-medium">
                        <input
                          type="checkbox"
                          className="size-5 accent-navy"
                          checked={closedCodes.includes(code)}
                          onChange={() => toggleClosed(code)}
                        />
                        Mark this issue fixed on this punch
                      </label>
                    ) : (
                      <p className="mt-2 text-xs font-semibold tracking-wide text-muted uppercase">
                        Already closed
                      </p>
                    )}
                    {marked ? (
                      <div className="mt-2">
                        <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
                          Close-out evidence
                        </p>
                        <p className="mb-2 text-sm text-muted">
                          Pictures print labeled{" "}
                          <span className="whitespace-nowrap text-ink">
                            {issue ? issueEvidenceCaption(issue) : code}
                          </span>
                          .
                        </p>
                        <PhotoDrop
                          compact
                          hint="Gallery or camera of the completed work"
                          onFiles={(added) =>
                            setEvidenceByCode((cur) => ({
                              ...cur,
                              [code]: [...(cur[code] || []), ...added],
                            }))
                          }
                        >
                          {files.length ? (
                            <p className="mb-1 text-sm font-semibold text-navy">
                              {files.length} picture{files.length === 1 ? "" : "s"} ready
                            </p>
                          ) : null}
                        </PhotoDrop>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </>
          )}

          <Field label="What happened">
            <Textarea
              value={draft.text}
              placeholder="Leave blank and tap Write line, or type it yourself"
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            />
          </Field>
          <Button width="full" variant="ghost" disabled={busy} onClick={() => void writeLine()}>
            {busy ? "Writing…" : "Write the line"}
          </Button>
          <Button
            width="full"
            onClick={() =>
              onSave(
                {
                  ...draft,
                  ...stampIssueCodes(codes),
                  closedCodes,
                  closed: closedCodes.length > 0,
                },
                { closedCodes, evidenceByCode },
              )
            }
          >
            Save punch
          </Button>
          <Button width="full" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
    </ModalSheet>
  );
}

function fallbackLine(
  d: TimelineEntry,
  selected: { code: string; title: string }[],
  closedCodes: string[],
  issues: Issue[],
) {
  const who = d.workers.length ? `${d.workers.join(", ")} ` : "We ";
  if (d.kind === "standby") {
    const where = d.standbyWhere === "hotel" ? "at the hotel" : "on site";
    const why =
      d.standbyReason === "worksite_closed"
        ? "the worksite was closed"
        : d.standbyReason === "no_access"
          ? "there was no access to the equipment"
          : d.standbyNote || "waiting on direction";
    return `${who}remained ${where} on standby because ${why}.`;
  }
  if (!selected.length) return d.text || `${who}continued field work.`;
  const list = selected.map((s) => s.code).join(", ");
  if (closedCodes.length === selected.length) {
    if (selected.length === 1) {
      const issue = issues.find((i) => i.code === selected[0].code);
      const what = issue?.title && issue.title !== issue.code ? issue.title : selected[0].code;
      return `${who}closed ${selected[0].code} after finishing ${what}.`;
    }
    return `${who}closed ${list}.`;
  }
  if (closedCodes.length) {
    return `${who}worked ${list} and closed ${closedCodes.join(", ")}.`;
  }
  if (selected.length === 1) {
    const issue = issues.find((i) => i.code === selected[0].code);
    const what = issue?.title && issue.title !== issue.code ? issue.title : "the issue";
    return `${who}worked ${what} (${selected[0].code}).`;
  }
  return `${who}worked ${list}.`;
}

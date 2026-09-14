import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { Issue } from "@/lib/dsr/types";
import {
  EMPTY_FILTERS,
  dispositionLabel,
  dispositionTone,
  filterIssues,
  normalizeIssueCode,
  priorityTone,
  statusLabel,
  uniqueValues,
  type IssueFilters,
} from "@/lib/dsr/cxalloy";
import { cn } from "@/lib/utils";
import { HScroll } from "./overflow";

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-10 shrink-0 rounded-full px-3 text-sm font-semibold",
        active ? "bg-navy text-card" : "bg-paper text-navy",
      )}
    >
      {children}
    </button>
  );
}

export function IssueFiltersBar({
  issues,
  filters,
  onChange,
}: {
  issues: Issue[];
  filters: IssueFilters;
  onChange: (f: IssueFilters) => void;
}) {
  const assets = useMemo(() => uniqueValues(issues, "asset"), [issues]);
  const types = useMemo(() => uniqueValues(issues, "type"), [issues]);
  const discs = useMemo(() => uniqueValues(issues, "discipline"), [issues]);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted" />
        <input
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
          placeholder="Search CHK, asset, title…"
          className="min-h-11 w-full rounded-lg border border-line bg-paper pr-3 pl-10 text-sm text-ink"
        />
      </div>
      <HScroll>
        <Chip active={!filters.priority} onClick={() => onChange({ ...filters, priority: "" })}>
          All P
        </Chip>
        {["P1", "P2", "P3"].map((p) => (
          <Chip
            key={p}
            active={filters.priority === p}
            onClick={() => onChange({ ...filters, priority: filters.priority === p ? "" : p })}
          >
            {p}
          </Chip>
        ))}
        <Chip active={!filters.status} onClick={() => onChange({ ...filters, status: "" })}>
          Any status
        </Chip>
        <Chip
          active={filters.status === "in_progress"}
          onClick={() =>
            onChange({ ...filters, status: filters.status === "in_progress" ? "" : "in_progress" })
          }
        >
          In progress
        </Chip>
        <Chip
          active={filters.status === "fixed"}
          onClick={() => onChange({ ...filters, status: filters.status === "fixed" ? "" : "fixed" })}
        >
          Fixed
        </Chip>
        <Chip
          active={filters.disposition === "ours"}
          onClick={() =>
            onChange({ ...filters, disposition: filters.disposition === "ours" ? "" : "ours" })
          }
        >
          MCG
        </Chip>
        <Chip
          active={filters.disposition === "reassigned"}
          onClick={() =>
            onChange({
              ...filters,
              disposition: filters.disposition === "reassigned" ? "" : "reassigned",
            })
          }
        >
          Reassigned
        </Chip>
        <Chip
          active={filters.disposition === "disputed"}
          onClick={() =>
            onChange({
              ...filters,
              disposition: filters.disposition === "disputed" ? "" : "disputed",
            })
          }
        >
          Dispute
        </Chip>
        <Chip
          active={filters.disposition === "as_designed"}
          onClick={() =>
            onChange({
              ...filters,
              disposition: filters.disposition === "as_designed" ? "" : "as_designed",
            })
          }
        >
          As designed
        </Chip>
        <Chip
          active={filters.disposition === "needs_engineering"}
          onClick={() =>
            onChange({
              ...filters,
              disposition: filters.disposition === "needs_engineering" ? "" : "needs_engineering",
            })
          }
        >
          Eng. review
        </Chip>
      </HScroll>
      {assets.length ? (
        <select
          className="min-h-11 w-full rounded-xl border border-line bg-card px-3 text-sm"
          value={filters.asset}
          onChange={(e) => onChange({ ...filters, asset: e.target.value })}
        >
          <option value="">All assets</option>
          {assets.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      ) : null}
      {types.length || discs.length ? (
        <div className="grid grid-cols-2 gap-2">
          {discs.length ? (
            <select
              className="min-h-11 rounded-xl border border-line bg-card px-3 text-sm"
              value={filters.discipline}
              onChange={(e) => onChange({ ...filters, discipline: e.target.value })}
            >
              <option value="">All disciplines</option>
              {discs.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          ) : null}
          {types.length ? (
            <select
              className="min-h-11 rounded-xl border border-line bg-card px-3 text-sm"
              value={filters.type}
              onChange={(e) => onChange({ ...filters, type: e.target.value })}
            >
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function IssueCard({
  issue,
  selected,
  onSelect,
}: {
  issue: Issue;
  selected?: boolean;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-xl p-3 text-left shadow-card",
        selected ? "bg-navy/10 ring-2 ring-navy" : "bg-card",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-bold text-navy">{issue.code}</span>
        {issue.priority ? (
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", priorityTone(issue.priority))}>
            {issue.priority}
            {issue.priorityLabel ? ` ${issue.priorityLabel}` : ""}
          </span>
        ) : null}
        <span className="rounded-full bg-paper px-2 py-0.5 text-[11px] font-semibold text-muted">
          {statusLabel(issue.status)}
        </span>
        {issue.disposition && issue.disposition !== "ours" ? (
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", dispositionTone(issue.disposition))}>
            {dispositionLabel(issue.disposition)}
          </span>
        ) : null}
      </div>
      <p className="mt-1 line-clamp-2 text-sm break-words text-ink">{issue.title}</p>
      <p className="mt-1 text-xs text-muted">
        {[
          issue.asset,
          issue.type || issue.discipline,
          issue.dueDate ? `Due ${issue.dueDate}` : "",
          issue.photoCount ? `${issue.photoCount} photo${issue.photoCount === 1 ? "" : "s"}` : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </button>
  );
}

export function IssuePicker({
  issues,
  value,
  onChange,
  selected,
  onToggle,
  multi = false,
  allowNone = true,
  onClose,
}: {
  issues: Issue[];
  value?: string;
  onChange?: (code: string) => void;
  selected?: string[];
  onToggle?: (code: string) => void;
  multi?: boolean;
  allowNone?: boolean;
  onClose?: () => void;
}) {
  const [filters, setFilters] = useState<IssueFilters>(EMPTY_FILTERS);
  const picked = multi ? selected ?? [] : value ? [value] : [];
  const [typed, setTyped] = useState(picked[0] || "");
  const list = useMemo(() => filterIssues(issues, filters), [issues, filters]);

  function pick(code: string) {
    if (multi) onToggle?.(code);
    else onChange?.(code);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{multi ? "CXAlloy issues" : "CXAlloy issue"}</h2>
        {onClose ? (
          <button type="button" className="grid size-10 place-items-center" onClick={onClose} aria-label="Close">
            <X className="size-5" />
          </button>
        ) : null}
      </div>
      {multi && picked.length ? (
        <p className="text-sm text-muted">
          {picked.length} selected: {picked.join(", ")}
        </p>
      ) : null}
      <div className="flex gap-2">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Type a code (CHK-123) even if not imported yet"
          className="min-h-11 flex-1 rounded-xl border border-line bg-card px-3 text-sm"
        />
        <button
          type="button"
          className="min-h-11 rounded-xl bg-navy px-3 text-sm font-semibold text-card"
          onClick={() => {
            const code = normalizeIssueCode(typed);
            if (code) pick(code);
          }}
        >
          Use
        </button>
      </div>
      <IssueFiltersBar issues={issues} filters={filters} onChange={setFilters} />
      {allowNone && !multi ? (
        <button
          type="button"
          className={cn(
            "w-full rounded-2xl border px-3 py-3 text-left text-sm font-semibold",
            value ? "border-line bg-card text-muted" : "border-navy bg-navy/5 text-navy",
          )}
          onClick={() => onChange?.("")}
        >
          None / general work
        </button>
      ) : null}
      <div className="max-h-[50dvh] space-y-2 overflow-y-auto">
        {list.length ? (
          list.map((i) => (
            <IssueCard
              key={i.id}
              issue={i}
              selected={picked.includes(i.code)}
              onSelect={() => pick(i.code)}
            />
          ))
        ) : (
          <p className="py-8 text-center text-sm text-muted">No issues match those filters.</p>
        )}
      </div>
      {multi ? (
        <button
          type="button"
          className="min-h-11 w-full rounded-xl bg-navy text-sm font-semibold text-card"
          onClick={() => onClose?.()}
        >
          Done
        </button>
      ) : null}
    </div>
  );
}

import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ModalSheet } from "./shell";
import { Button } from "@/components/ui/button";

export function PickTrigger({
  summary,
  empty,
  onClick,
  count,
}: {
  summary: string;
  empty?: string;
  onClick: () => void;
  count?: number;
}) {
  const blank = !summary;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 w-full min-w-0 items-center gap-3 rounded-lg bg-paper px-3 text-left"
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm font-semibold",
          blank ? "text-muted" : "text-ink",
        )}
      >
        {blank ? empty || "Tap to choose" : summary}
      </span>
      {typeof count === "number" && count > 0 ? (
        <span className="shrink-0 rounded-full bg-navy px-2 py-0.5 text-xs font-bold text-card">
          {count}
        </span>
      ) : null}
      <ChevronDown className="size-5 shrink-0 text-muted" />
    </button>
  );
}

export function ListRow({
  selected,
  onClick,
  children,
  hint,
}: {
  selected?: boolean;
  onClick: () => void;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 w-full min-w-0 items-center gap-3 border-b border-line py-2 text-left last:border-0"
    >
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-semibold text-ink">{children}</span>
        {hint ? <span className="mt-0.5 block text-xs text-muted">{hint}</span> : null}
      </span>
      {selected ? <Check className="size-5 shrink-0 text-navy" /> : null}
    </button>
  );
}

export function PickSheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <ModalSheet onClose={onClose} labelledBy="pick-sheet-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="pick-sheet-title" className="min-w-0 truncate text-lg font-semibold text-ink">
          {title}
        </h2>
        <Button type="button" variant="ghost" className="shrink-0" onClick={onClose}>
          Done
        </Button>
      </div>
      <div className="min-w-0">{children}</div>
      {footer}
    </ModalSheet>
  );
}

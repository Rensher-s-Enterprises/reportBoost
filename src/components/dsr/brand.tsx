import { cn } from "@/lib/utils";

export function DsrMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-lg bg-cyan text-[11px] font-bold tracking-wide text-navy",
        className,
      )}
      aria-hidden
    >
      DSR
    </div>
  );
}

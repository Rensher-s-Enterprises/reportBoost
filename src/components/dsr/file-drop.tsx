import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { FileUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BulkProgress } from "@/lib/dsr/bulk-import";
import { MoreText } from "./overflow";

export function FileDrop({
  accept,
  multiple = true,
  busy,
  progress,
  label,
  shortLabel,
  hint,
  onInput,
  children,
}: {
  accept: string;
  multiple?: boolean;
  busy?: boolean;
  progress?: BulkProgress | null;
  label: string;
  shortLabel?: string;
  hint: string;
  onInput: (input: FileList | DataTransfer) => void;
  children?: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  function onDrag(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setOver(true);
    if (e.type === "dragleave") setOver(false);
  }

  return (
    <div
      className={cn(
        "rounded-xl p-4 shadow-card transition-colors sm:flex sm:items-center sm:justify-between sm:gap-4",
        over ? "bg-cyan/10 ring-2 ring-cyan" : "bg-card",
      )}
      onDragEnter={onDrag}
      onDragOver={onDrag}
      onDragLeave={onDrag}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        if (!busy) onInput(e.dataTransfer);
      }}
    >
      {children}
      <button
        type="button"
        disabled={busy}
        className="mx-auto flex min-h-11 max-w-full items-center justify-center gap-2 rounded-lg bg-navy px-3 text-sm font-semibold text-card disabled:opacity-60 sm:mx-0 sm:shrink-0 sm:px-4"
        onClick={() => ref.current?.click()}
      >
        <FileUp className="size-4 shrink-0" />
        <span className="truncate">
          {busy ? "Importing…" : <><span className="sm:hidden">{shortLabel || label}</span><span className="hidden sm:inline">{label}</span></>}
        </span>
      </button>
      <div className="mt-2 min-w-0 sm:mt-0 sm:flex-1">
        <MoreText className="text-center sm:text-left">
          {busy && progress
            ? `${progress.done}/${progress.total} · ${progress.imported} new · ${progress.photos || 0} pics · ${progress.skipped} skipped${progress.needsDate ? ` · ${progress.needsDate} need a date` : ""}${progress.current ? ` · ${progress.current}` : ""}`
            : over
              ? "Drop PDFs or a ZIP now"
              : hint}
        </MoreText>
      </div>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        disabled={busy}
        onChange={(e) => {
          if (e.target.files?.length) onInput(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

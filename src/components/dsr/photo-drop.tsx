import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { Camera, ImagePlus } from "lucide-react";
import { cn } from "@/lib/utils";

const ACCEPT = "image/*,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp,.gif";

export function imageFilesFrom(input: FileList | File[] | DataTransfer | null | undefined): File[] {
  if (!input) return [];
  const files: File[] = [];
  if (input instanceof DataTransfer) {
    if (input.files?.length) files.push(...input.files);
    else {
      for (const item of Array.from(input.items || [])) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
  } else {
    files.push(...Array.from(input));
  }
  return files.filter((f) => {
    const t = (f.type || "").toLowerCase();
    const n = f.name.toLowerCase();
    return t.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp|gif|bmp|tiff?)$/.test(n);
  });
}

export function PhotoDrop({
  onFiles,
  busy,
  label = "Add pictures",
  hint = "Gallery, camera, or drop files here",
  compact,
  children,
}: {
  onFiles: (files: File[]) => void;
  busy?: boolean;
  label?: string;
  hint?: string;
  compact?: boolean;
  children?: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  function take(list: FileList | File[] | DataTransfer | null | undefined) {
    const files = imageFilesFrom(list);
    if (files.length) onFiles(files);
  }

  function onDrag(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setOver(true);
    if (e.type === "dragleave") setOver(false);
  }

  return (
    <div
      className={cn(
        "dsr-card overflow-hidden rounded-xl p-3 shadow-card transition-colors",
        over ? "bg-cyan/10 ring-2 ring-cyan" : "bg-card",
        compact && "p-2",
      )}
      onDragEnter={onDrag}
      onDragOver={onDrag}
      onDragLeave={onDrag}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        take(e.dataTransfer);
      }}
    >
      {children}
      <div className={cn("flex flex-wrap items-center justify-center gap-2", children && "mt-2")}>
        <button
          type="button"
          disabled={busy}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy px-3 text-sm font-semibold text-card disabled:opacity-60"
          onClick={() => galleryRef.current?.click()}
        >
          <ImagePlus className="size-4" />
          {busy ? "Adding…" : "Gallery"}
        </button>
        <button
          type="button"
          disabled={busy}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-paper px-3 text-sm font-semibold text-navy disabled:opacity-60"
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="size-4" />
          Camera
        </button>
        <p className="line-clamp-2 w-full text-center text-xs text-muted">
          {over ? "Drop pictures now" : hint}
        </p>
      </div>
      <input
        ref={galleryRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}

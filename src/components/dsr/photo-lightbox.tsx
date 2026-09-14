import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from "lucide-react";
import { getIssuePhoto, getPhoto } from "@/lib/dsr/api";

export type LightboxItem = {
  id: string;
  mime: string;
  caption?: string;
  source?: "report" | "issue";
};

export function PhotoLightbox({
  items,
  index,
  onClose,
  onIndex,
  extra,
}: {
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
  extra?: React.ReactNode;
}) {
  const item = items[index];
  const source = item?.source || "report";
  const q = useQuery({
    queryKey: [source === "issue" ? "issue-photo" : "photo", item?.id],
    queryFn: () =>
      source === "issue" ? getIssuePhoto({ data: item.id }) : getPhoto({ data: item.id }),
    enabled: Boolean(item?.id),
    staleTime: 120_000,
  });
  const src = q.data?.dataB64
    ? `data:${q.data.mime || item.mime};base64,${q.data.dataB64}`
    : "";
  const caption = (q.data && "caption" in q.data ? q.data.caption : "") || item?.caption || "";

  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const pinch = useRef<{ dist: number; scale: number } | null>(null);

  useEffect(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onIndex((index - 1 + items.length) % items.length);
      if (e.key === "ArrowRight") onIndex((index + 1) % items.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onIndex]);

  if (!item) return null;

  const zoomBy = (next: number, cx = 0, cy = 0) => {
    const clamped = Math.min(4, Math.max(1, next));
    setScale(clamped);
    if (clamped === 1) setPan({ x: 0, y: 0 });
    else if (cx || cy) setPan((p) => ({ x: p.x + cx, y: p.y + cy }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-navy-3/95 text-card"
      role="dialog"
      aria-modal="true"
      aria-label="Examine photo"
    >
      <div className="flex items-center gap-2 px-3 pt-[max(10px,env(safe-area-inset-top))] pb-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
          {items.length > 1 ? `${index + 1} / ${items.length}` : "Photo"}
        </p>
        <button
          type="button"
          className="grid size-11 place-items-center rounded-xl bg-navy/60"
          aria-label="Zoom out"
          onClick={() => zoomBy(scale - 0.5)}
        >
          <ZoomOut className="size-5" />
        </button>
        <button
          type="button"
          className="grid size-11 place-items-center rounded-xl bg-navy/60"
          aria-label="Zoom in"
          onClick={() => zoomBy(scale + 0.5)}
        >
          <ZoomIn className="size-5" />
        </button>
        <button
          type="button"
          className="grid size-11 place-items-center rounded-xl bg-navy/60"
          aria-label="Close"
          onClick={onClose}
        >
          <X className="size-5" />
        </button>
      </div>

      <div
        className="relative min-h-0 flex-1 touch-none overflow-hidden"
        onDoubleClick={() => zoomBy(scale > 1 ? 1 : 2.2)}
        onWheel={(e) => {
          e.preventDefault();
          zoomBy(scale + (e.deltaY < 0 ? 0.2 : -0.2));
        }}
        onPointerDown={(e) => {
          if (scale <= 1) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setPan({
            x: drag.current.px + (e.clientX - drag.current.x),
            y: drag.current.py + (e.clientY - drag.current.y),
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onTouchStart={(e) => {
          if (e.touches.length === 2) {
            const [a, b] = [e.touches[0], e.touches[1]];
            const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
            pinch.current = { dist, scale };
            drag.current = null;
          }
        }}
        onTouchMove={(e) => {
          if (e.touches.length === 2 && pinch.current) {
            const [a, b] = [e.touches[0], e.touches[1]];
            const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
            zoomBy((pinch.current.scale * dist) / pinch.current.dist);
          }
        }}
        onTouchEnd={() => {
          pinch.current = null;
        }}
      >
        {src ? (
          <img
            src={src}
            alt={caption || "Issue photo"}
            className="absolute inset-0 m-auto max-h-full max-w-full object-contain select-none"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              transformOrigin: "center center",
            }}
            draggable={false}
          />
        ) : (
          <div className="absolute inset-8 animate-pulse rounded-2xl bg-navy/50" />
        )}
        {items.length > 1 ? (
          <>
            <button
              type="button"
              className="absolute top-1/2 left-2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-navy-3/70"
              aria-label="Previous photo"
              onClick={() => onIndex((index - 1 + items.length) % items.length)}
            >
              <ChevronLeft className="size-6" />
            </button>
            <button
              type="button"
              className="absolute top-1/2 right-2 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-navy-3/70"
              aria-label="Next photo"
              onClick={() => onIndex((index + 1) % items.length)}
            >
              <ChevronRight className="size-6" />
            </button>
          </>
        ) : null}
      </div>

      <div className="space-y-2 px-4 pt-2 pb-[max(16px,env(safe-area-inset-bottom))]">
        {caption ? <p className="text-sm leading-snug text-card/90">{caption}</p> : null}
        {extra}
        <p className="text-xs text-card/60">Pinch or use + / − to zoom. Swipe arrows for the next picture.</p>
      </div>
    </div>
  );
}

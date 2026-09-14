import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Horizontal chip/action row: swipe to see the rest, fade hints there is more. */
export function HScroll({
  children,
  className,
  fadeFrom = "from-paper",
}: {
  children: ReactNode;
  className?: string;
  fadeFrom?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  function measure() {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdge({
      left: el.scrollLeft > 6,
      right: max > 6 && el.scrollLeft < max - 6,
    });
  }

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [children]);

  return (
    <div className={cn("relative min-w-0", className)}>
      <div ref={ref} className="dsr-hscroll flex gap-1.5 pb-1">
        {children}
      </div>
      {edge.left ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 w-8 bg-linear-to-r to-transparent",
            fadeFrom,
          )}
        />
      ) : null}
      {edge.right ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 w-8 bg-linear-to-l to-transparent",
            fadeFrom,
          )}
        />
      ) : null}
    </div>
  );
}

/** Long helper copy: two lines on a phone, tap to expand. */
export function MoreText({
  children,
  className,
  lines = "line-clamp-2",
}: {
  children: ReactNode;
  className?: string;
  lines?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [needed, setNeeded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setNeeded(el.scrollHeight > el.clientHeight + 1);
    if (open) {
      setNeeded(true);
      return;
    }
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children, open]);

  return (
    <div>
      <p
        ref={ref}
        className={cn("text-xs leading-relaxed text-muted", !open && lines, className)}
      >
        {children}
      </p>
      {needed ? (
        <button
          type="button"
          className="mt-1 min-h-11 text-xs font-semibold text-cyan-2 sm:min-h-0"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Expand } from "lucide-react";
import { getIssuePhoto, getPhoto } from "@/lib/dsr/api";
import type { PhotoMeta } from "@/lib/dsr/types";

export function PhotoThumb({
  photo,
  source = "report",
  onInspect,
}: {
  photo: Pick<PhotoMeta, "id" | "mime">;
  source?: "report" | "issue";
  onInspect?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setOn(true);
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const q = useQuery({
    queryKey: [source === "issue" ? "issue-photo" : "photo", photo.id],
    queryFn: () =>
      source === "issue" ? getIssuePhoto({ data: photo.id }) : getPhoto({ data: photo.id }),
    enabled: on,
    staleTime: 120_000,
  });
  const inner = q.data?.dataB64 ? (
    <img
      src={`data:${q.data.mime || photo.mime};base64,${q.data.dataB64}`}
      alt=""
      className="size-full object-cover"
    />
  ) : (
    <div className="size-full animate-pulse bg-muted/25" />
  );

  return (
    <div ref={ref} className="relative size-full bg-line">
      {onInspect ? (
        <button type="button" className="size-full" onClick={onInspect} aria-label="Examine photo">
          {inner}
        </button>
      ) : (
        inner
      )}
      {onInspect ? (
        <span className="pointer-events-none absolute right-1.5 bottom-1.5 grid size-8 place-items-center rounded-lg bg-navy-3/70 text-card">
          <Expand className="size-4" />
        </span>
      ) : null}
    </div>
  );
}

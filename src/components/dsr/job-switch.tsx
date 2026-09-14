import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { listProjects } from "@/lib/dsr/api";
import { setLastProjectId } from "@/lib/last-project";

export function JobSwitch({ currentId }: { currentId: string }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["projects"], queryFn: () => listProjects() });
  const jobs = q.data ?? [];
  if (jobs.length < 2) return null;
  return (
    <label className="shrink-0">
      <span className="sr-only">Switch job</span>
      <select
        className="max-w-28 truncate rounded-lg bg-card/12 px-2 py-1.5 text-xs font-semibold text-card outline-none sm:max-w-44 lg:max-w-52 lg:border lg:border-line lg:bg-card lg:text-ink"
        value={currentId}
        onChange={(e) => {
          const id = e.target.value;
          setLastProjectId(id);
          navigate({ to: "/project/$projectId", params: { projectId: id } });
        }}
      >
        {jobs.map((j) => (
          <option key={j.id} value={j.id} className="text-navy">
            {j.name || j.customer || j.wo || "Job"}
          </option>
        ))}
      </select>
    </label>
  );
}

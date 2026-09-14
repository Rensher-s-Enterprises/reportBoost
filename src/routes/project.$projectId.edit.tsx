import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SignInGate, RedirectToSignIn } from "@/lib/auth/gates";
import { getProject } from "@/lib/dsr/api";
import { AppShell } from "@/components/dsr/shell";
import { ProjectForm } from "@/components/dsr/project-form";

export const Route = createFileRoute("/project/$projectId/edit")({ component: EditProject });

function EditProject() {
  const { projectId } = Route.useParams();
  const q = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject({ data: projectId }),
  });
  return (
    <SignInGate fallback={<RedirectToSignIn />}>
      <AppShell
        title="Edit job details"
        eyebrow="Prefill once"
        backTo={`/project/${projectId}`}
        jobId={projectId}
      >
        {q.isLoading ? (
          <div className="h-64 animate-pulse rounded-xl bg-card" />
        ) : (
          <ProjectForm existing={q.data} />
        )}
      </AppShell>
    </SignInGate>
  );
}

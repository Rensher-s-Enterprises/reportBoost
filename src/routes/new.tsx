import { createFileRoute } from "@tanstack/react-router";
import { SignInGate, RedirectToSignIn } from "@/lib/auth/gates";
import { AppShell } from "@/components/dsr/shell";
import { ProjectForm } from "@/components/dsr/project-form";

export const Route = createFileRoute("/new")({ component: NewProject });

function NewProject() {
  return (
    <SignInGate fallback={<RedirectToSignIn />}>
      <AppShell title="New job" eyebrow="Prefill once" backTo="/">
        <p className="mb-4 max-w-2xl text-sm text-muted">
          Save the job details once. Every daily report after that picks them up automatically.
        </p>
        <ProjectForm />
      </AppShell>
    </SignInGate>
  );
}

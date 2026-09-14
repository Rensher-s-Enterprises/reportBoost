import { Outlet, createFileRoute } from "@tanstack/react-router";
import { SignInGate, RedirectToSignIn } from "@/lib/auth/gates";

export const Route = createFileRoute("/project/$projectId")({
  component: ProjectLayout,
});

function ProjectLayout() {
  return (
    <SignInGate fallback={<RedirectToSignIn />}>
      <Outlet />
    </SignInGate>
  );
}

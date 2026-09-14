import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, CalendarDays, Download, FolderOpen, UserRound } from "lucide-react";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getLastProjectId } from "@/lib/last-project";
import { openDayReport } from "@/lib/dsr/api";
import { cn, todayISO } from "@/lib/utils";
import { toast } from "sonner";
import type { ReactNode } from "react";
import { DsrMark } from "./brand";
import { JobSwitch } from "./job-switch";

export function AppShell({
  title,
  eyebrow = "DSR Field",
  backTo,
  jobId,
  actions,
  contentClassName,
  children,
}: {
  title: string;
  eyebrow?: string;
  backTo?: string;
  jobId?: string;
  actions?: ReactNode;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh min-w-0 max-w-full overflow-x-hidden bg-paper lg:flex lg:h-dvh lg:overflow-hidden">
      <DesktopSidebar />
      <div className="flex min-w-0 flex-1 flex-col lg:h-dvh">
        <AppHeader
          title={title}
          eyebrow={eyebrow}
          backTo={backTo}
          jobId={jobId}
          actions={actions}
        />
        <main
          className={cn(
            "dsr-gutter mx-auto w-full min-w-0 max-w-6xl flex-1 overflow-x-hidden pt-4 lg:overflow-y-auto lg:pt-6",
            "pb-[calc(5.75rem+env(safe-area-inset-bottom))] lg:pb-8",
            contentClassName,
          )}
        >
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}

export function AppHeader({
  title,
  eyebrow = "DSR Field",
  backTo,
  jobId,
  actions,
}: {
  title: string;
  eyebrow?: string;
  backTo?: string;
  jobId?: string;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <header className="dsr-gutter sticky top-0 z-20 flex min-w-0 items-center gap-2 overflow-hidden bg-navy pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 text-card sm:gap-3 lg:border-b lg:border-line lg:bg-card lg:py-3.5 lg:pt-3.5 lg:text-ink">
      <DsrMark className="lg:hidden" />
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="truncate text-xs tracking-widest text-card/70 uppercase lg:text-muted">
          {eyebrow}
        </div>
        <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">{title}</h1>
      </div>
      {jobId ? (
        <div className="hidden min-w-0 sm:block">
          <JobSwitch currentId={jobId} />
        </div>
      ) : null}
      {actions ? <div className="hidden shrink-0 items-center gap-2 lg:flex">{actions}</div> : null}
      {backTo ? (
        <button
          type="button"
          aria-label="Back"
          className="grid size-11 shrink-0 place-items-center rounded-lg bg-card/12 lg:bg-paper lg:text-navy"
          onClick={() => navigate({ to: backTo })}
        >
          <ArrowLeft className="size-5" />
        </button>
      ) : null}
    </header>
  );
}

function useAppNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const onProjects = pathname === "/" || pathname === "/new";
  const onExport = pathname.includes("/export");
  const onToday = pathname.includes("/report/");
  const onMe = pathname === "/me";

  async function goToday() {
    const id = getLastProjectId();
    if (!id) {
      toast.message("Open a project first");
      navigate({ to: "/" });
      return;
    }
    try {
      const report = await openDayReport({ data: { projectId: id, workDate: todayISO() } });
      navigate({
        to: "/project/$projectId/report/$reportId",
        params: { projectId: id, reportId: report.id },
      });
    } catch {
      toast.error("Could not open today's report. Sign in again if needed.");
    }
  }

  async function goExport() {
    const id = getLastProjectId();
    if (!id) {
      toast.message("Open a project first");
      navigate({ to: "/" });
      return;
    }
    navigate({ to: "/project/$projectId/export", params: { projectId: id } });
  }

  return { onProjects, onToday, onExport, onMe, goToday, goExport };
}

function DesktopSidebar() {
  const { user, isPending } = useCurrentUserState();
  const { onProjects, onToday, onExport, onMe, goToday, goExport } = useAppNav();
  const item = (active: boolean) =>
    cn(
      "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors duration-150",
      active ? "bg-card/12 text-card" : "text-card/70 hover:bg-card/10 hover:text-card",
    );

  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-navy-3 text-card lg:flex">
      <div className="flex items-center gap-3 px-5 py-5">
        <DsrMark />
        <div className="min-w-0">
          <div className="text-xs tracking-widest text-cyan uppercase">Field reports</div>
          <div className="truncate font-semibold">DSR Field</div>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        <Link to="/" className={item(onProjects)}>
          <FolderOpen className="size-5" />
          Jobs
        </Link>
        <button type="button" onClick={goToday} className={item(onToday)}>
          <CalendarDays className="size-5" />
          Today
        </button>
        <button type="button" onClick={goExport} className={item(onExport)}>
          <Download className="size-5" />
          Export
        </button>
        <Link to="/me" className={item(onMe)}>
          <UserRound className="size-5" />
          My details
        </Link>
      </nav>
      <div className="min-w-0 overflow-hidden border-t border-card/10 px-4 py-4 [&_span]:min-w-0 [&_span]:truncate [&_span]:text-card [&_button]:shrink-0 [&_button]:text-card/70">
        {isPending ? (
          <div className="h-8 w-32 animate-pulse rounded-lg bg-card/10" />
        ) : user ? (
          <UserButton />
        ) : null}
      </div>
    </aside>
  );
}

export function BottomNav() {
  const { onProjects, onToday, onExport, onMe, goToday, goExport } = useAppNav();
  const item = "flex min-h-12 flex-col items-center justify-center gap-0.5 py-2 text-xs font-semibold";
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
      <Link to="/" className={`${item} ${onProjects ? "text-navy" : "text-muted"}`}>
        <FolderOpen className="size-5" />
        Jobs
      </Link>
      <button type="button" onClick={goToday} className={`${item} ${onToday ? "text-navy" : "text-muted"}`}>
        <CalendarDays className="size-5" />
        Today
      </button>
      <button type="button" onClick={goExport} className={`${item} ${onExport ? "text-navy" : "text-muted"}`}>
        <Download className="size-5" />
        Export
      </button>
      <Link to="/me" className={`${item} ${onMe ? "text-navy" : "text-muted"}`}>
        <UserRound className="size-5" />
        Me
      </Link>
    </nav>
  );
}

export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("w-full", className)}>{children}</div>;
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("dsr-card overflow-hidden rounded-xl bg-card p-3 shadow-card sm:p-5", className)}>
      {children}
    </div>
  );
}

export function FormGrid({
  children,
  wide,
  className,
}: {
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("dsr-form-grid", wide && "dsr-form-grid-wide", className)}>{children}</div>
  );
}

export function SectionLabel({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-2 flex min-w-0 items-end justify-between gap-3", className)}>
      <p className="min-w-0 truncate text-xs font-semibold tracking-widest text-muted uppercase">
        {children}
      </p>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function ModalSheet({
  children,
  onClose,
  wide,
  labelledBy,
}: {
  children: ReactNode;
  onClose?: () => void;
  wide?: boolean;
  labelledBy?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-navy-3/50 p-0 sm:items-center sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cn(
          "max-h-[92dvh] w-full max-w-full overflow-x-hidden overflow-y-auto rounded-t-2xl bg-card p-4 shadow-lift sm:max-h-[85dvh] sm:rounded-xl sm:p-5",
          wide ? "sm:max-w-2xl" : "sm:max-w-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function AuthSplit({
  children,
  mobileTone = "navy",
}: {
  children: ReactNode;
  mobileTone?: "navy" | "paper";
}) {
  return (
    <main
      className={cn(
        "min-h-dvh md:grid md:grid-cols-2",
        mobileTone === "navy" ? "bg-navy-3" : "bg-paper",
      )}
    >
      <section className="relative hidden flex-col justify-between overflow-hidden bg-navy-3 px-8 py-10 text-card md:flex lg:px-12 lg:py-12">
        <div className="flex items-center gap-3">
          <DsrMark className="size-11 text-sm" />
          <div>
            <div className="text-xs tracking-widest text-cyan uppercase">Field reports</div>
            <div className="text-lg font-semibold">DSR Field</div>
          </div>
        </div>
        <div className="max-w-md">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl lg:text-4xl">
            Punch the day from any phone or laptop.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-card/70">
            Save the job once. After that it’s hours, photos, and the official PDF — on a phone
            in the field or a laptop in the trailer.
          </p>
        </div>
        <p className="text-sm text-card/50">Mission Critical Group · Daily Service Reports</p>
      </section>
      <section
        className={cn(
          "flex min-h-dvh items-center justify-center px-4 py-10 sm:px-8 md:bg-paper",
          mobileTone === "paper" && "bg-paper",
        )}
      >
        <div className="w-full max-w-md">{children}</div>
      </section>
    </main>
  );
}

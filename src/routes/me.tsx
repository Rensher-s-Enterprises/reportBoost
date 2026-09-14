import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SignInGate, RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import {
  deleteRosterPerson,
  getProfile,
  listRoster,
  saveProfile,
  saveRosterPerson,
} from "@/lib/dsr/api";
import { emptyProfile, type TechProfile } from "@/lib/dsr/types";
import { initialsFromName } from "@/lib/utils";
import { AppShell, Panel, SectionLabel } from "@/components/dsr/shell";
import { Button } from "@/components/ui/button";
import { Field, HhmmInput, Input } from "@/components/ui/field";
import { queryClient } from "@/lib/query";

export const Route = createFileRoute("/me")({ component: MePage });

function MePage() {
  return (
    <SignInGate fallback={<RedirectToSignIn />}>
      <Inner />
    </SignInGate>
  );
}

function Inner() {
  const user = useCurrentUser();
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: () => getProfile() });
  const rosterQ = useQuery({ queryKey: ["roster"], queryFn: () => listRoster() });
  const [form, setForm] = useState<TechProfile>(emptyProfile());
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmp, setNewEmp] = useState("");

  useEffect(() => {
    if (!profileQ.data) return;
    const p = profileQ.data;
    setForm({
      ...p,
      fullName: p.fullName || user?.displayName || "",
      email: p.email || user?.primaryEmail || "",
      initials: p.initials || initialsFromName(p.fullName || user?.displayName || ""),
    });
  }, [profileQ.data, user?.displayName, user?.primaryEmail]);

  async function onSave() {
    setBusy(true);
    try {
      await saveProfile({ data: form });
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Your details are saved. New days and PDFs will use them.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="My details" backTo="/">
        <p className="mb-4 max-w-2xl text-sm text-muted">
          Fill this in once. Today’s report, the technician line, employee #, and report number
          initials come from here.
        </p>
        <Panel>
          <div className="dsr-form-grid">
            <Field label="Full name" className="dsr-span-all">
              <Input
                value={form.fullName}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    fullName: e.target.value,
                    initials: f.initials || initialsFromName(e.target.value),
                  }))
                }
              />
            </Field>
            <Field label="Initials (report no.)">
              <Input
                value={form.initials}
                onChange={(e) => setForm((f) => ({ ...f, initials: e.target.value.toUpperCase() }))}
              />
            </Field>
            <Field label="Employee number">
              <Input
                value={form.employeeNumber}
                onChange={(e) => setForm((f) => ({ ...f, employeeNumber: e.target.value }))}
              />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </Field>
            <Field label="Email">
              <Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </Field>
            <Field label="Default time on">
              <HhmmInput
                value={form.defaultTimeOn}
                onChange={(defaultTimeOn) => setForm((f) => ({ ...f, defaultTimeOn }))}
              />
            </Field>
            <Field label="Default time off">
              <HhmmInput
                value={form.defaultTimeOff}
                onChange={(defaultTimeOff) => setForm((f) => ({ ...f, defaultTimeOff }))}
              />
            </Field>
          </div>
          <Button className="mt-4" width="full" disabled={busy} onClick={() => void onSave()}>
            {busy ? "Saving…" : "Save my details"}
          </Button>
        </Panel>

        <SectionLabel className="mt-8">Crew roster</SectionLabel>
        <p className="mb-3 text-sm text-muted">
          People you work with often. Tap them onto a day’s crew instead of typing names again.
        </p>
        <div className="mb-3 flex min-w-0 flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Input
            className="sm:w-28"
            placeholder="Emp #"
            value={newEmp}
            onChange={(e) => setNewEmp(e.target.value)}
          />
          <Button
            variant="outline"
            onClick={async () => {
              if (!newName.trim()) return;
              await saveRosterPerson({ data: { name: newName.trim(), employeeNumber: newEmp } });
              setNewName("");
              setNewEmp("");
              await queryClient.invalidateQueries({ queryKey: ["roster"] });
            }}
          >
            Add
          </Button>
        </div>
        <div className="space-y-2">
          {(rosterQ.data ?? []).map((p) => (
            <div
              key={p.id}
              className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 shadow-card"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{p.name}</p>
                <p className="text-xs text-muted">
                  {p.initials}
                  {p.employeeNumber ? ` · #${p.employeeNumber}` : ""}
                </p>
              </div>
              <button
                type="button"
                className="min-h-11 px-2 text-xs font-semibold text-danger"
                onClick={async () => {
                  await deleteRosterPerson({ data: p.id });
                  await queryClient.invalidateQueries({ queryKey: ["roster"] });
                }}
              >
                Remove
              </button>
            </div>
          ))}
          {!(rosterQ.data ?? []).length ? (
            <p className="text-sm text-muted">No roster yet. Add the names you travel with.</p>
          ) : null}
        </div>
    </AppShell>
  );
}

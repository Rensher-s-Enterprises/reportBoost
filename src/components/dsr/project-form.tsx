import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { deleteProject, getProfile, saveProject } from "@/lib/dsr/api";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/query";
import { setLastProjectId } from "@/lib/last-project";
import { emptyProject, type Project } from "@/lib/dsr/types";
import { initialsFromName, namesFromCrew, uid } from "@/lib/utils";
import { useCurrentUser } from "@/lib/auth/use-current-user";

export function ProjectForm({ existing }: { existing?: Project | null }) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: () => getProfile() });
  const seed = existing ?? {
    ...emptyProject(),
    id: "",
    technician: "",
    initials: "",
    createdAt: "",
    updatedAt: "",
  };
  const [form, setForm] = useState(seed);
  useEffect(() => {
    if (existing || !profileQ.data) return;
    const p = profileQ.data;
    setForm((f) => ({
      ...f,
      technician: f.technician || p.fullName || user?.displayName || "",
      initials: f.initials || p.initials || initialsFromName(p.fullName || user?.displayName || ""),
      defaultTimeOn: p.defaultTimeOn || f.defaultTimeOn,
      defaultTimeOff: p.defaultTimeOff || f.defaultTimeOff,
    }));
  }, [existing, profileQ.data, user?.displayName]);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof Project>(k: K, v: Project[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSave() {
    setBusy(true);
    try {
      const initials = form.initials || initialsFromName(form.technician) || "XXX";
      const id = await saveProject({
        data: { ...form, id: form.id || uid(), initials: initials.toUpperCase() } as Project,
      });
      setLastProjectId(id);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["people", id] });
      toast.success("Project saved");
      navigate({ to: "/project/$projectId", params: { projectId: id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!form.id) return;
    if (!confirm("Delete this project and all of its reports?")) return;
    await deleteProject({ data: form.id });
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
    toast.success("Project deleted");
    navigate({ to: "/" });
  }

  const roster = namesFromCrew(form.crew);

  return (
    <div className="dsr-card rounded-xl bg-card p-3 shadow-card sm:p-6">
      <div className="dsr-form-grid">
        <Field label="Project name" className="dsr-span-all">
          <Input
            value={form.name}
            placeholder="Job name as you call it"
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field label="Customer">
          <Input
            value={form.customer}
            placeholder="Customer or GC"
            onChange={(e) => set("customer", e.target.value)}
          />
        </Field>
        <Field label="Work order">
          <Input value={form.wo} placeholder="WO #" onChange={(e) => set("wo", e.target.value)} />
        </Field>
        <Field label="Location">
          <Input
            value={form.location}
            placeholder="City, ST"
            onChange={(e) => set("location", e.target.value)}
          />
        </Field>
        <Field label="P.O. Number">
          <Input value={form.po} onChange={(e) => set("po", e.target.value)} />
        </Field>
        <Field label="Charge code">
          <Input value={form.chargeCode} onChange={(e) => set("chargeCode", e.target.value)} />
        </Field>
        <Field label="Type of transportation" className="dsr-span-all">
          <Input
            value={form.transportation}
            onChange={(e) => set("transportation", e.target.value)}
          />
        </Field>
        <Field label="Generator size">
          <Input
            value={form.generatorSize}
            onChange={(e) => set("generatorSize", e.target.value)}
          />
        </Field>
        <Field label="Qty">
          <Input value={form.qty} onChange={(e) => set("qty", e.target.value)} />
        </Field>
        <Field label="Operating voltage">
          <Input
            value={form.operatingVoltage}
            onChange={(e) => set("operatingVoltage", e.target.value)}
          />
        </Field>
        <Field label="DC voltage">
          <Input value={form.dcVoltage} onChange={(e) => set("dcVoltage", e.target.value)} />
        </Field>
        <Field label="Switchgear manufacturer">
          <Input
            value={form.switchgearMfr}
            placeholder="Manufacturer"
            onChange={(e) => set("switchgearMfr", e.target.value)}
          />
        </Field>
        <Field label="Prints or job # and date">
          <Input
            value={form.prints}
            placeholder="Drawing # and date"
            onChange={(e) => set("prints", e.target.value)}
          />
        </Field>
        <Field label="Job task" className="dsr-span-all">
          <Textarea
            value={form.jobTask}
            placeholder="What this job is"
            onChange={(e) => set("jobTask", e.target.value)}
          />
        </Field>
        <Field label="Technician on site (your name)" className="dsr-span-all">
          <Input
            value={form.technician}
            placeholder="Taken from your account"
            onChange={(e) => {
              const technician = e.target.value;
              setForm((f) => ({
                ...f,
                technician,
                initials: initialsFromName(technician) || f.initials,
              }));
            }}
          />
          <span className="text-xs text-muted">
            Matches the name on your account. Change only if someone else is signing this job.
          </span>
        </Field>
        <Field label="Initials for report No.">
          <Input
            value={form.initials}
            maxLength={4}
            onChange={(e) => set("initials", e.target.value.toUpperCase())}
          />
          <span className="text-xs text-muted">
            Taken from the technician name (Alex Rivera → AR)
          </span>
        </Field>
        <Field label="Default time on">
          <Input value={form.defaultTimeOn} onChange={(e) => set("defaultTimeOn", e.target.value)} />
        </Field>
        <Field label="Default time off">
          <Input
            value={form.defaultTimeOff}
            onChange={(e) => set("defaultTimeOff", e.target.value)}
          />
        </Field>
        <Field label="Crew roster (add people, comma separated)" className="dsr-span-all">
          <Input
            value={form.crew}
            placeholder="Alex Rivera, Jordan Lee, Sam Patel"
            onChange={(e) => set("crew", e.target.value)}
          />
          {roster.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {roster.map((n) => (
                <span
                  key={n}
                  className="rounded-full bg-paper px-2.5 py-1 text-xs font-semibold text-navy"
                >
                  {n} · {initialsFromName(n)}
                </span>
              ))}
            </div>
          ) : null}
          <span className="text-xs text-muted">
            This is the pool. Each day you pick who is actually on site.
          </span>
        </Field>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <Button type="button" width="full" onClick={onSave} disabled={busy}>
          {busy ? "Saving…" : "Save project"}
        </Button>
        {existing?.id ? (
          <Button type="button" variant="danger" width="full" onClick={onDelete}>
            Delete project
          </Button>
        ) : null}
      </div>
    </div>
  );
}

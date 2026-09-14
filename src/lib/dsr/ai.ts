import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Issue, TimelineEntry } from "./types";

export const parseCxalloyText = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { text: string }) => d)
  .handler(async ({ data }) => {
    const { parseCxalloyIssues } = await import("./ai.server");
    return parseCxalloyIssues(data.text);
  });

export const refineCxalloyImport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      text: string;
      seeds: {
        code: string;
        title: string;
        description: string;
        status: string;
        priority?: string;
        asset?: string;
        assignedTo?: string;
      }[];
    }) => d,
  )
  .handler(async ({ data }) => {
    const { runRefineCxalloyImport } = await import("./ai.server");
    return runRefineCxalloyImport(data);
  });

export const polishDay = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      entries: TimelineEntry[];
      issues: Pick<Issue, "code" | "title" | "description" | "status">[];
      comments: string;
      crew: string[];
      jobTask?: string;
    }) => d,
  )
  .handler(async ({ data }) => {
    const { runPolishDay } = await import("./ai.server");
    return runPolishDay(data);
  });

export const narratePunch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      kind: "work" | "standby";
      workers: string[];
      issue?: { code: string; title: string; description: string } | null;
      issues?: { code: string; title: string; description: string }[];
      closedCodes?: string[];
      markFixed: boolean;
      minutes: number;
      note: string;
      standbyWhere?: string;
      standbyReason?: string;
    }) => d,
  )
  .handler(async ({ data }) => {
    const { runNarratePunch } = await import("./ai.server");
    return runNarratePunch(data);
  });

export const parseDsrWithLlm = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { text: string }) => d)
  .handler(async ({ data }) => {
    const { llmParseDsr } = await import("./ai.server");
    return llmParseDsr(data.text);
  });

export const refineDsrImport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      text: string;
      parsed: {
        workDate?: string;
        reportNo?: string;
        customer?: string;
        wo?: string;
        location?: string;
        technician?: string;
        jobTask?: string;
        timeOn?: string;
        timeOff?: string;
        comments?: string;
        entries?: { time?: string; text?: string; cxalloy?: string; workers?: string[]; kind?: string }[];
      };
      issues?: { code: string; title: string; description?: string }[];
    }) => d,
  )
  .handler(async ({ data }) => {
    const { runRefineDsrImport } = await import("./ai.server");
    return runRefineDsrImport(data);
  });

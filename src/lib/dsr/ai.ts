import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { env } from "@/lib/env.server";
import type { Issue, TimelineEntry } from "./types";
import { fleshOutDay } from "./polish";
import { parseJson } from "./llm-json";

type ChatOk = { ok: true; text: string };
type ChatFail = { ok: false; error: string };

const MODEL = "grok-4.5";

function messageText(body: {
  choices?: {
    message?: { content?: string | null; reasoning_content?: string | null };
    finish_reason?: string;
  }[];
  error?: { message?: string };
}) {
  const msg = body.choices?.[0]?.message;
  const content = typeof msg?.content === "string" ? msg.content.trim() : "";
  if (content) return content;
  const reasoning = typeof msg?.reasoning_content === "string" ? msg.reasoning_content.trim() : "";
  // Reasoning models dump chain-of-thought here; only reuse it if it looks like JSON.
  if (reasoning.includes("{")) return reasoning;
  return "";
}

async function chatOnce(
  apiKey: string,
  system: string,
  user: string,
  maxTokens: number,
  opts: { jsonObject: boolean; reasoningEffort: "low" | null },
): Promise<ChatOk | ChatFail> {
  const payload: Record<string, unknown> = {
    model: MODEL,
    max_tokens: maxTokens,
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (opts.reasoningEffort) payload.reasoning_effort = opts.reasoningEffort;
  if (opts.jsonObject) payload.response_format = { type: "json_object" };

  let res: Response;
  try {
    res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "network error";
    return { ok: false, error: `Writing help timed out or could not reach xAI (${msg}).` };
  }

  const raw = await res.text();
  let body: {
    choices?: {
      message?: { content?: string | null; reasoning_content?: string | null };
      finish_reason?: string;
    }[];
    error?: { message?: string };
  } = {};
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    body = {};
  }
  if (!res.ok) {
    const detail = String(body.error?.message || raw || "").slice(0, 220);
    return {
      ok: false,
      error: detail
        ? `Writing help failed (${res.status}): ${detail}`
        : `Writing help failed (${res.status}).`,
    };
  }
  const text = messageText(body);
  if (!text.trim()) {
    const reason = body.choices?.[0]?.finish_reason || "empty";
    return {
      ok: false,
      error:
        reason === "length"
          ? "Writing help ran out of tokens. Try fewer punches, then polish again."
          : "Writing help returned an empty reply.",
    };
  }
  return { ok: true, text };
}

async function chat(system: string, user: string, maxTokens = 4096): Promise<ChatOk | ChatFail> {
  const apiKey = env("XAI_API_KEY");
  if (!apiKey) return { ok: false, error: "Writing help is not available right now." };

  // grok-4.5 reasons by default; json_object + tiny max_tokens used to eat the
  // whole budget on thinking and return empty content. Low effort + room to write.
  const first = await chatOnce(apiKey, system, user, maxTokens, {
    jsonObject: false,
    reasoningEffort: "low",
  });
  if (first.ok) return first;

  const dropReasoning = /reasoning_effort|unknown parameter|400/i.test(first.error);
  const dropJson = /response_format|json_object/i.test(first.error);

  const retry = await chatOnce(apiKey, system, user, Math.max(maxTokens, 4096), {
    jsonObject: !dropJson,
    reasoningEffort: dropReasoning ? null : "low",
  });
  if (retry.ok) return retry;
  return first;
}

async function chatJson<T>(
  system: string,
  user: string,
  maxTokens: number,
): Promise<{ ok: true; data: T } | ChatFail> {
  const first = await chat(system, user, maxTokens);
  if (first.ok) {
    const data = parseJson<T>(first.text);
    if (data) return { ok: true, data };
  }
  const apiKey = env("XAI_API_KEY");
  if (!apiKey) return first.ok ? { ok: false, error: "Writing help returned text that was not JSON." } : first;
  const forced = await chatOnce(apiKey, `${system}\nReply with a JSON object only.`, user, maxTokens, {
    jsonObject: true,
    reasoningEffort: "low",
  });
  if (forced.ok) {
    const data = parseJson<T>(forced.text);
    if (data) return { ok: true, data };
  }
  return {
    ok: false,
    error: first.ok
      ? "Writing help returned text that was not JSON."
      : first.error,
  };
}

export const parseCxalloyText = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { text: string }) => d)
  .handler(async ({ data }) => parseCxalloyIssues(data.text));

function asIssueStatus(raw: unknown): Issue["status"] | undefined {
  const s = String(raw || "").toUpperCase();
  if (/FIXED|CLOSED|COMPLETE/.test(s)) return "fixed";
  if (/PROGRESS/.test(s)) return "in_progress";
  if (/OPEN/.test(s)) return "open";
  return undefined;
}

function mapLlmCxalloyIssues(
  issues: {
    code?: string;
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    priorityLabel?: string;
    assignedTo?: string;
    asset?: string;
    discipline?: string;
    type?: string;
    dueDate?: string;
    createdBy?: string;
    identifiedOn?: string;
    disposition?: string;
    dispositionNote?: string;
  }[],
) {
  return issues
    .map((i) => ({
      code: String(i.code || "").trim().replace(/\s+/g, " ").slice(0, 40),
      title: String(i.title || "").trim().slice(0, 180),
      description: String(i.description || "").trim().slice(0, 1200),
      status: asIssueStatus(i.status),
      priority: String(i.priority || "").toUpperCase().slice(0, 4),
      priorityLabel: String(i.priorityLabel || "").slice(0, 24),
      assignedTo: String(i.assignedTo || "").slice(0, 80),
      asset: String(i.asset || "").slice(0, 80),
      discipline: String(i.discipline || "").slice(0, 40),
      type: String(i.type || "").slice(0, 40),
      dueDate: String(i.dueDate || "").slice(0, 40),
      createdBy: String(i.createdBy || "").slice(0, 80),
      identifiedOn: String(i.identifiedOn || "").slice(0, 40),
      disposition: asDispositionLlm(i.disposition),
      dispositionNote: String(i.dispositionNote || "").slice(0, 280),
    }))
    .filter((i) => i.code);
}

function asDispositionLlm(raw: unknown): Issue["disposition"] | undefined {
  const t = String(raw || "")
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (t === "reassigned" || t === "disputed" || t === "as_designed" || t === "needs_engineering" || t === "ours") {
    return t;
  }
  if (/reassign/.test(t)) return "reassigned";
  if (/design/.test(t)) return "as_designed";
  if (/engineer/.test(t)) return "needs_engineering";
  if (/disput/.test(t)) return "disputed";
  return undefined;
}

export async function parseCxalloyIssues(source: string) {
  const text = String(source || "").slice(0, 40_000);
  if (!text.trim()) return { ok: false as const, error: "Nothing to parse." };
  const result = await chatJson<{
    issues?: {
      code?: string;
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      priorityLabel?: string;
      assignedTo?: string;
      asset?: string;
      discipline?: string;
      type?: string;
      dueDate?: string;
      createdBy?: string;
      identifiedOn?: string;
    }[];
  }>(
    `You extract electrical commissioning punch-list / CXAlloy / CHK / FO issues from messy field documents.
Return JSON only: {"issues":[{"code":"CHK-123","title":"short problem title not a filename","description":"1-4 sentences","status":"in_progress or fixed or open","disposition":"ours","dispositionNote":"","priority":"P1|P2|P3","priorityLabel":"HIGH|MODERATE|LOW","assignedTo":"","asset":"","discipline":"","type":"","dueDate":"","createdBy":"","identifiedOn":""}]}.
status=fixed when the document says CLOSED, FIXED, or COMPLETE. status=in_progress for IN PROGRESS. status=open for OPEN.
disposition is who should act: "ours" (MCG to fix), "reassigned" (given to another contractor / not our scope), "disputed" (inspector flagged it but field disagrees), "as_designed" (built as conceived, not a defect), "needs_engineering" (design must confirm if it is really an issue).
Keep original codes. Skip headers, signatures, and photo filenames. Do not invent codes.`,
    text,
    8192,
  );
  if (!result.ok) return result;
  return { ok: true as const, issues: mapLlmCxalloyIssues(result.data.issues ?? []) };
}

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
    const result = await chatJson<{
      issues?: {
        code?: string;
        title?: string;
        description?: string;
        status?: string;
        priority?: string;
        priorityLabel?: string;
        assignedTo?: string;
        asset?: string;
        discipline?: string;
        type?: string;
        dueDate?: string;
        createdBy?: string;
        identifiedOn?: string;
      }[];
    }>(
      `You refine a CXAlloy Construction Issues list. You get PDF text and a parser snapshot.
Correct status, ownership, and fill missing fields. Do not invent issue codes.
status must be "fixed" (CLOSED/FIXED/COMPLETE), "in_progress" (IN PROGRESS), or "open".
disposition: "ours" (MCG to fix in the field), "reassigned" (pushed to another trade / not MCG scope), "disputed" (inspector vs field), "as_designed" (that is how it was conceived/built), "needs_engineering" (design should confirm it is really an issue).
Title is the problem, never a photo filename or UUID.
Return JSON: {"issues":[{"code":"CHK-…","title":"","description":"","status":"in_progress","disposition":"ours","dispositionNote":"","priority":"P2","priorityLabel":"","assignedTo":"","asset":"","discipline":"","type":"","dueDate":"","createdBy":"","identifiedOn":""}]}`,
      JSON.stringify({
        pdfText: data.text.slice(0, 16_000),
        parser: data.seeds.slice(0, 80),
      }),
      8192,
    );
    if (!result.ok) return result;
    return { ok: true as const, issues: mapLlmCxalloyIssues(result.data.issues ?? []) };
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
    const local = fleshOutDay({
      entries: data.entries,
      issues: data.issues,
      comments: data.comments,
      crew: data.crew,
      jobTask: data.jobTask,
    });
    const result = await chatJson<{ comments?: string; entries?: { id?: string; text?: string }[] }>(
      `You are a field electrician writing a Daily Service Report hour log.
Rules:
- Keep facts. Do not invent work, people, or issue codes.
- Write like field notes, not a form. One or two natural sentences per punch.
- Lead with the work done, then the result. Never start with only "CHK-123 was closed."
- If named technicians are on the punch, write as those people (first name is fine). Do not also list them in parentheses or brackets.
- Mention a CHK/FO code at most once, inside the sentence, only if it helps. Do not append a second "(CHK-…)" tag.
- If the issue was closed, say it once in plain language. Do not add a separate "Closed." stamp.
- Standby: say they were on standby, where, and why.
Return JSON only: {"comments":"...","entries":[{"id":"...","text":"..."}]} with the same entry ids.`,
      JSON.stringify({
        jobTask: data.jobTask || "",
        crew: data.crew,
        comments: data.comments,
        issues: data.issues,
        entries: data.entries.map((e) => ({
          id: e.id,
          time: e.time,
          endTime: e.endTime,
          kind: e.kind,
          workers: e.workers,
          cxalloy: e.cxalloy,
          cxalloys: e.cxalloys,
          closedCodes: e.closedCodes,
          standbyWhere: e.standbyWhere,
          standbyReason: e.standbyReason,
          standbyNote: e.standbyNote,
          text: e.text,
        })),
      }),
      8192,
    );
    if (!result.ok) {
      return {
        ok: true as const,
        comments: local.comments,
        entries: local.entries,
        usedAi: false as const,
        notice: result.error,
      };
    }
    const incoming = (result.data.entries || [])
      .map((e) => ({ id: String(e.id || ""), text: String(e.text || "").trim() }))
      .filter((e) => e.id && e.text);
    const byId = new Map(incoming.map((e) => [e.id, e.text]));
    const localById = new Map(local.entries.map((e) => [e.id, e.text]));
    const merged = data.entries.map((e) => ({
      id: e.id,
      text: byId.get(e.id) || localById.get(e.id) || e.text,
    }));
    if (!merged.some((e) => e.text)) {
      return {
        ok: true as const,
        comments: local.comments,
        entries: local.entries,
        usedAi: false as const,
        notice: "AI did not return usable lines, so the issue list was used instead.",
      };
    }
    return {
      ok: true as const,
      comments: String(result.data.comments || local.comments),
      entries: merged,
      usedAi: incoming.length > 0,
    };
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
    const result = await chatJson<{ text?: string }>(
      `Write ONE Daily Service Report punch line (1-2 sentences, past tense), like a tech's field notes.
Lead with the work, then the result. If a person is named, write as that person (first name is fine) — do not also put their name in parentheses.
If several CHK/FO codes were worked, name each code once. If some were closed, say which. No quotes, no markdown, no "[Name]" or extra "(CODE)" tags.
Return JSON: {"text":"..."}`,
      JSON.stringify(data),
      2048,
    );
    if (!result.ok) return result;
    const text = String(result.data.text || "").trim();
    if (!text) return { ok: false as const, error: "Writing help returned an empty line." };
    return { ok: true as const, text };
  });

export const parseDsrWithLlm = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { text: string }) => d)
  .handler(async ({ data }) => llmParseDsr(data.text));

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
    const issues = (data.issues || []).slice(0, 60);
    const result = await chatJson<{
      customer?: string;
      wo?: string;
      location?: string;
      technician?: string;
      jobTask?: string;
      timeOn?: string;
      timeOff?: string;
      mileage?: string;
      estimatedCost?: string;
      materialUsed?: string;
      partsNeededText?: string;
      comments?: string;
      reportNo?: string;
      workDate?: string;
      crewToday?: string[];
      entries?: {
        time?: string;
        endTime?: string;
        text?: string;
        cxalloy?: string;
        workers?: string[];
        kind?: string;
        closed?: boolean;
      }[];
    }>(
      `You refine a Mission Critical Group Daily Service Report.
You get messy PDF text, a deterministic parser snapshot, and optional known CXAlloy issues.
Fill gaps and assign CHK/FO codes. Do not invent work, people, dates, or issue codes.
Rules:
- Keep parser workDate if it is already YYYY-MM-DD. Never guess a different date.
- Assign cxalloy from the known issue list when the punch describes that issue, even if the CHK/FO code is missing.
- Only use codes from the known list or codes that literally appear in that punch. Never invent a new code.
- closed=true when the punch says the work on that issue was finished/fixed/closed; otherwise leave closed false (in progress).
- Split each timestamp into its own entry. Times are HHMM.
- kind=standby only if the line is waiting/hotel/no access, not productive work.
- closed=true only if that punch says the issue was closed/fixed.
- Fill empty customer, WO, technician, location, jobTask only from evidence in the text.
Return JSON:
{"customer":"","wo":"","location":"","technician":"","jobTask":"","timeOn":"","timeOff":"","comments":"","crewToday":[],"entries":[{"time":"HHMM","endTime":"","text":"","cxalloy":"","workers":[],"kind":"work","closed":false}]}`,
      JSON.stringify({
        pdfText: data.text.slice(0, 12_000),
        parser: data.parsed,
        knownIssues: issues,
      }),
      4096,
    );
    if (!result.ok) return result;
    return { ok: true as const, parsed: result.data };
  });

export async function llmParseDsr(text: string) {
  const result = await chatJson<{
    workDate?: string;
    reportNo?: string;
    timeOn?: string;
    timeOff?: string;
    mileage?: string;
    estimatedCost?: string;
    materialUsed?: string;
    partsNeededText?: string;
    comments?: string;
    technician?: string;
    entries?: {
      time?: string;
      endTime?: string;
      text?: string;
      cxalloy?: string;
      workers?: string[];
      kind?: string;
    }[];
  }>(
    `You extract a Mission Critical Group Daily Service Report from messy PDF text.
Return JSON only:
{"workDate":"YYYY-MM-DD","reportNo":"","timeOn":"HHMM","timeOff":"HHMM","mileage":"","estimatedCost":"","materialUsed":"","partsNeededText":"","comments":"","technician":"","entries":[{"time":"HHMM","endTime":"","text":"what happened","cxalloy":"CHK- or FO- code or empty","workers":["names if stated"],"kind":"work or standby"}]}
Keep original times and facts. Split each timestamp into its own entry. Do not invent work.`,
    text.slice(0, 14_000),
    4096,
  );
  if (!result.ok) return result;
  return { ok: true as const, parsed: result.data };
}

/** Pull a JSON object out of model text (fences, leading prose, or raw). */
export function extractJsonObject(raw: string): string | null {
  const t = String(raw || "").trim();
  if (!t) return null;
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : t).trim();
  if (body.startsWith("{") && body.endsWith("}")) return body;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) return body.slice(start, end + 1);
  return null;
}

export function parseJson<T>(raw: string): T | null {
  const slice = extractJsonObject(raw);
  if (!slice) return null;
  try {
    return JSON.parse(slice) as T;
  } catch {
    return null;
  }
}

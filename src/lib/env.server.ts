import { execFileSync } from "node:child_process";

const windowsUserCache = new Map<string, string | undefined>();

function windowsUserEnv(name: string): string | undefined {
  if (process.platform !== "win32") return undefined;
  if (windowsUserCache.has(name)) return windowsUserCache.get(name);
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) return undefined;
  try {
    const value = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", `[Environment]::GetEnvironmentVariable('${name}','User')`],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    const next = value || undefined;
    windowsUserCache.set(name, next);
    return next;
  } catch {
    windowsUserCache.set(name, undefined);
    return undefined;
  }
}

export function env(key: string): string | undefined {
  const v = process.env[key]?.trim();
  if (v) return v;
  if (key === "XAI_API_KEY") return windowsUserEnv(key);
  return undefined;
}

/**
 * Workspace preview vs deployed app. The deployer writes GROK_PROJECT_ID on
 * every publish; the sandbox preview never has it. Single source of truth for
 * the split — gate audience, gate endpoints and connector-token semantics all
 * key off this predicate.
 */
export function isWorkspacePreview(): boolean {
  return !env("GROK_PROJECT_ID");
}

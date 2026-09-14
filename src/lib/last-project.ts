const KEY = "dsr.lastProjectId";

export function getLastProjectId() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setLastProjectId(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}

export function clearLastProjectId() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

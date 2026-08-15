import { DEFAULT_EXCLUDED_PATTERNS } from "./defaults";

export function normaliseRelativePath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .replace(/\/{2,}/gu, "/")
    .replace(/\/$/u, "")
    .normalize("NFC");
}

export function pathKey(path: string): string {
  return normaliseRelativePath(path).toLocaleLowerCase("en-US");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function globToRegExp(pattern: string): RegExp {
  const normalised = normaliseRelativePath(pattern);
  let source = "";
  for (let index = 0; index < normalised.length; index += 1) {
    const character = normalised[index];
    const next = normalised[index + 1];
    if (character === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(character);
    }
  }
  return new RegExp(`^${source}$`, "iu");
}

export class PathRules {
  private readonly expressions: RegExp[];

  constructor(extraPatterns: string[]) {
    this.expressions = [...DEFAULT_EXCLUDED_PATTERNS, ...extraPatterns]
      .map((pattern) => pattern.trim())
      .filter(Boolean)
      .map(globToRegExp);
  }

  isExcluded(path: string): boolean {
    const normalised = normaliseRelativePath(path);
    return normalised.length === 0 || this.expressions.some((expression) => expression.test(normalised));
  }
}

export function parentPaths(path: string): string[] {
  const parts = normaliseRelativePath(path).split("/");
  const result: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    result.push(parts.slice(0, index).join("/"));
  }
  return result;
}

export function conflictPath(path: string, deviceName: string, now = new Date()): string {
  const safeDevice = deviceName.replace(/[\\/:*?"<>|]/gu, "-").trim() || "устройство";
  const stamp = now.toISOString().replace(/[:.]/gu, "-");
  const slash = path.lastIndexOf("/");
  const directory = slash >= 0 ? path.slice(0, slash + 1) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return `${directory}${name} (конфликт ${safeDevice} ${stamp})`;
  }
  return `${directory}${name.slice(0, dot)} (конфликт ${safeDevice} ${stamp})${name.slice(dot)}`;
}

export function caseCollisionPath(path: string, sequence = 1): string {
  const normalised = normaliseRelativePath(path);
  const slash = normalised.lastIndexOf("/");
  const directory = slash >= 0 ? normalised.slice(0, slash + 1) : "";
  const name = slash >= 0 ? normalised.slice(slash + 1) : normalised;
  const dot = name.lastIndexOf(".");
  const suffix = sequence === 1 ? " (различие регистра)" : ` (различие регистра ${sequence})`;
  if (dot <= 0) return `${directory}${name}${suffix}`;
  return `${directory}${name.slice(0, dot)}${suffix}${name.slice(dot)}`;
}

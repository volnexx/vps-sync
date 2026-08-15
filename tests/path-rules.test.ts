import { describe, expect, it } from "vitest";
import { caseCollisionPath, conflictPath, pathKey, PathRules } from "../src/path-rules";

describe("PathRules", () => {
  it("excludes device-local and synchroniser files", () => {
    const rules = new PathRules([]);
    expect(rules.isExcluded(".obsidian/workspace.json")).toBe(true);
    expect(rules.isExcluded(".obsidian/plugins/vps-sync/data.json")).toBe(true);
    expect(rules.isExcluded(".obsidian/plugins/vps-sync-0.1.1/data.json")).toBe(true);
    expect(rules.isExcluded(".obsidian/plugins/activity/data.json")).toBe(false);
    expect(rules.isExcluded(".obsidian/themes/Minimal/theme.css")).toBe(false);
  });

  it("supports user glob patterns", () => {
    const rules = new PathRules(["private/**", "*.tmp"]);
    expect(rules.isExcluded("private/secret.md")).toBe(true);
    expect(rules.isExcluded("cache.tmp")).toBe(true);
    expect(rules.isExcluded("notes/cache.tmp")).toBe(false);
  });

  it("normalises Unicode and case for collision detection", () => {
    expect(pathKey("Папка/Языки.md")).toBe(pathKey("папка/языки.md"));
  });

  it("preserves the extension in conflict copies", () => {
    const result = conflictPath("папка/заметка.md", "iPhone", new Date("2026-08-15T12:34:56.000Z"));
    expect(result).toBe("папка/заметка (конфликт iPhone 2026-08-15T12-34-56-000Z).md");
  });

  it("preserves both files when their names differ only by case", () => {
    expect(caseCollisionPath("Фильмы.md")).toBe("Фильмы (различие регистра).md");
    expect(caseCollisionPath("папка/Фильмы.md", 2)).toBe("папка/Фильмы (различие регистра 2).md");
  });
});

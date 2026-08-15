import { describe, expect, it } from "vitest";
import { appendActivity, describeReport, formatActivityLog, formatErrorReport } from "../src/activity";
import type { ActivityLogEntry, SyncReport } from "../src/types";

function report(errors: string[] = []): SyncReport {
  return {
    startedAt: 1_000,
    finishedAt: 2_000,
    uploaded: 3,
    downloaded: 4,
    deletedLocal: 1,
    deletedRemote: 2,
    conflicts: 0,
    unchanged: 8,
    skipped: 0,
    errors
  };
}

describe("activity journal", () => {
  it("collapses identical consecutive messages instead of flooding the panel", () => {
    const once = appendActivity([], "warning", "Синхронизация уже выполняется", 1_000);
    const twice = appendActivity(once, "warning", "Синхронизация уже выполняется", 2_000);
    expect(twice).toHaveLength(1);
    expect(twice[0].count).toBe(2);
    expect(twice[0].timestamp).toBe(2_000);
  });

  it("keeps only the latest 200 journal entries", () => {
    let entries: ActivityLogEntry[] = [];
    for (let index = 0; index < 205; index += 1) {
      entries = appendActivity(entries, "info", `Сообщение ${index}`, index * 61_000);
    }
    expect(entries).toHaveLength(200);
    expect(entries[0].message).toBe("Сообщение 5");
  });

  it("formats a complete copyable error report", () => {
    const text = formatErrorReport("0.1.6", "iPhone", ["notes/a.md: ошибка расшифровки"], report(["x"]));
    expect(text).toContain("VPS Sync 0.1.6");
    expect(text).toContain("Устройство: iPhone");
    expect(text).toContain("1. notes/a.md: ошибка расшифровки");
  });

  it("formats summaries and repetition counts for the side panel", () => {
    expect(describeReport(report())).toContain("отправлено 3, получено 4");
    const text = formatActivityLog([
      { timestamp: 1_000, level: "success", message: "Готово", count: 3 }
    ]);
    expect(text).toContain("[success] ×3 Готово");
  });
});

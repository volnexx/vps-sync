import type { ActivityLevel, ActivityLogEntry, SyncReport } from "./types";

const MAX_ACTIVITY_ENTRIES = 200;
const REPEAT_WINDOW_MS = 60_000;

export function appendActivity(
  entries: ActivityLogEntry[],
  level: ActivityLevel,
  message: string,
  timestamp = Date.now()
): ActivityLogEntry[] {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) return entries;

  const previous = entries.at(-1);
  if (
    previous &&
    previous.level === level &&
    previous.message === trimmedMessage &&
    timestamp - previous.timestamp <= REPEAT_WINDOW_MS
  ) {
    return [
      ...entries.slice(0, -1),
      {
        ...previous,
        timestamp,
        count: previous.count + 1
      }
    ];
  }

  return [
    ...entries,
    {
      timestamp,
      level,
      message: trimmedMessage,
      count: 1
    }
  ].slice(-MAX_ACTIVITY_ENTRIES);
}

export function describeReport(report: SyncReport): string {
  const parts = [
    `отправлено ${report.uploaded}`,
    `получено ${report.downloaded}`,
    `удалено локально ${report.deletedLocal}`,
    `удалено на сервере ${report.deletedRemote}`,
    `конфликтов ${report.conflicts}`
  ];
  if (report.skipped > 0) parts.push(`пропущено ${report.skipped}`);
  if (report.errors.length > 0) parts.push(`ошибок ${report.errors.length}`);
  return `VPS Sync: ${parts.join(", ")}`;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString("ru-RU");
}

export function formatErrorReport(
  version: string,
  deviceName: string,
  errors: string[],
  report?: SyncReport
): string {
  const lines = [`VPS Sync ${version}`, `Устройство: ${deviceName}`];
  if (report) {
    lines.push(`Время: ${formatTimestamp(report.finishedAt)}`);
    lines.push(describeReport(report));
  }
  lines.push("");
  if (errors.length === 0) {
    lines.push("Ошибок последней синхронизации нет.");
  } else {
    lines.push(`Ошибки (${errors.length}):`);
    lines.push(...errors.map((error, index) => `${index + 1}. ${error}`));
  }
  return lines.join("\n");
}

export function formatActivityLog(entries: ActivityLogEntry[]): string {
  if (entries.length === 0) return "Журнал VPS Sync пуст.";
  return entries
    .map((entry) => {
      const repeat = entry.count > 1 ? ` ×${entry.count}` : "";
      return `[${formatTimestamp(entry.timestamp)}] [${entry.level}]${repeat} ${entry.message}`;
    })
    .join("\n");
}

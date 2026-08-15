import { ItemView, type WorkspaceLeaf } from "obsidian";
import type VpsSyncPlugin from "./main";
import type { ActivityLevel, SyncReport } from "./types";

export const VPS_SYNC_VIEW_TYPE = "vps-sync-panel";

const LEVEL_LABELS: Record<ActivityLevel, string> = {
  info: "Сведения",
  success: "Успех",
  warning: "Предупреждение",
  error: "Ошибка"
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export class VpsSyncPanelView extends ItemView {
  private statusValueEl?: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: VpsSyncPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VPS_SYNC_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "VPS Sync";
  }

  getIcon(): string {
    return "refresh-cw";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("vps-sync-panel");
    this.refresh();
  }

  async onClose(): Promise<void> {
    this.statusValueEl = undefined;
  }

  updateStatus(status: string): void {
    if (!this.statusValueEl) return;
    this.statusValueEl.setText(status);
    this.statusValueEl.toggleClass("is-error", status === "ошибка");
    this.statusValueEl.toggleClass("is-paused", status === "приостановлено");
    this.statusValueEl.toggleClass("is-ready", status === "готово");
  }

  refresh(): void {
    const container = this.contentEl;
    container.empty();

    const header = container.createDiv({ cls: "vps-sync-panel-header" });
    header.createEl("h2", { text: "VPS Sync" });
    header.createSpan({ text: `v${this.plugin.manifest.version}`, cls: "vps-sync-version" });

    const statusCard = container.createDiv({ cls: "vps-sync-status-card" });
    statusCard.createDiv({ text: "Состояние", cls: "vps-sync-section-label" });
    this.statusValueEl = statusCard.createDiv({ cls: "vps-sync-current-status" });
    this.updateStatus(this.plugin.getCurrentStatus());

    const controls = container.createDiv({ cls: "vps-sync-controls" });
    this.addButton(controls, "Синхронизировать", () => this.plugin.syncNow(true), true);
    this.addButton(controls, "Проверить", () => this.plugin.testConnection());
    this.addButton(
      controls,
      this.plugin.data.settings.paused ? "Включить" : "Приостановить",
      () => this.plugin.togglePaused()
    );

    this.renderLastReport(container, this.plugin.data.state.lastReport);
    this.renderErrors(container);
    this.renderActivity(container);
  }

  private renderLastReport(container: HTMLElement, report?: SyncReport): void {
    if (!report) return;
    const section = container.createDiv({ cls: "vps-sync-panel-section" });
    const heading = section.createDiv({ cls: "vps-sync-section-heading" });
    heading.createEl("h3", { text: "Последняя синхронизация" });
    heading.createSpan({ text: formatTime(report.finishedAt), cls: "vps-sync-muted" });

    const metrics = section.createDiv({ cls: "vps-sync-metrics" });
    this.addMetric(metrics, "Отправлено", report.uploaded);
    this.addMetric(metrics, "Получено", report.downloaded);
    this.addMetric(metrics, "Удалено здесь", report.deletedLocal);
    this.addMetric(metrics, "Удалено на VPS", report.deletedRemote);
    this.addMetric(metrics, "Конфликты", report.conflicts, report.conflicts > 0 ? "warning" : undefined);
    this.addMetric(metrics, "Ошибки", report.errors.length, report.errors.length > 0 ? "error" : undefined);
  }

  private renderErrors(container: HTMLElement): void {
    const errors = this.plugin.data.state.lastErrors;
    const section = container.createDiv({ cls: "vps-sync-panel-section" });
    const heading = section.createDiv({ cls: "vps-sync-section-heading" });
    heading.createEl("h3", { text: `Ошибки (${errors.length})` });

    const copyButton = heading.createEl("button", { text: "Скопировать" });
    copyButton.disabled = errors.length === 0;
    copyButton.addEventListener("click", () => void this.runButtonAction(copyButton, () => this.plugin.copyErrors()));

    if (errors.length === 0) {
      section.createDiv({ text: "Последняя синхронизация завершилась без ошибок.", cls: "vps-sync-empty" });
      return;
    }

    const list = section.createDiv({ cls: "vps-sync-error-list" });
    for (const error of errors.slice(0, 20)) {
      list.createDiv({ text: error, cls: "vps-sync-error-item" });
    }
    if (errors.length > 20) {
      section.createDiv({ text: `Ещё ${errors.length - 20}. Полный перечень копируется кнопкой выше.`, cls: "vps-sync-muted" });
    }
  }

  private renderActivity(container: HTMLElement): void {
    const entries = this.plugin.data.state.activityLog;
    const section = container.createDiv({ cls: "vps-sync-panel-section" });
    const heading = section.createDiv({ cls: "vps-sync-section-heading" });
    heading.createEl("h3", { text: "Журнал" });

    const actions = heading.createDiv({ cls: "vps-sync-heading-actions" });
    const copyButton = actions.createEl("button", { text: "Копировать" });
    copyButton.disabled = entries.length === 0;
    copyButton.addEventListener("click", () => void this.runButtonAction(copyButton, () => this.plugin.copyActivityLog()));
    const clearButton = actions.createEl("button", { text: "Очистить" });
    clearButton.disabled = entries.length === 0;
    clearButton.addEventListener("click", () => void this.runButtonAction(clearButton, () => this.plugin.clearActivityLog()));

    if (entries.length === 0) {
      section.createDiv({ text: "Сообщений пока нет.", cls: "vps-sync-empty" });
      return;
    }

    const list = section.createDiv({ cls: "vps-sync-activity-list" });
    for (const entry of [...entries].reverse()) {
      const item = list.createDiv({ cls: `vps-sync-activity-item is-${entry.level}` });
      const meta = item.createDiv({ cls: "vps-sync-activity-meta" });
      meta.createSpan({ text: LEVEL_LABELS[entry.level] });
      const repeats = entry.count > 1 ? ` · ×${entry.count}` : "";
      meta.createSpan({ text: `${formatTime(entry.timestamp)}${repeats}` });
      item.createDiv({ text: entry.message, cls: "vps-sync-activity-message" });
    }
  }

  private addMetric(
    container: HTMLElement,
    label: string,
    value: number,
    level?: "warning" | "error"
  ): void {
    const metric = container.createDiv({ cls: `vps-sync-metric${level ? ` is-${level}` : ""}` });
    metric.createDiv({ text: String(value), cls: "vps-sync-metric-value" });
    metric.createDiv({ text: label, cls: "vps-sync-metric-label" });
  }

  private addButton(container: HTMLElement, label: string, action: () => Promise<void>, primary = false): void {
    const button = container.createEl("button", {
      text: label,
      cls: primary ? "mod-cta" : undefined
    });
    button.addEventListener("click", () => void this.runButtonAction(button, action));
  }

  private async runButtonAction(button: HTMLButtonElement, action: () => Promise<void>): Promise<void> {
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.plugin.recordActivity("error", message);
    } finally {
      this.refresh();
    }
  }
}

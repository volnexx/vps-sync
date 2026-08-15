import { Platform, Plugin, type WorkspaceLeaf } from "obsidian";
import { appendActivity, describeReport, formatActivityLog, formatErrorReport } from "./activity";
import { createDefaultData } from "./defaults";
import { SyncEngine } from "./engine";
import { VPS_SYNC_VIEW_TYPE, VpsSyncPanelView } from "./panel-view";
import { VpsSyncSettingTab } from "./settings-tab";
import type { ActivityLevel, InitialMode, PersistedData } from "./types";

export default class VpsSyncPlugin extends Plugin {
  data!: PersistedData;
  private engine!: SyncEngine;
  private currentStatus = "загрузка";
  private lastAutomaticRun = 0;
  private changeTimer?: number;
  private saveQueue: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    await this.loadPluginData();
    this.setStatus(this.data.settings.paused ? "приостановлено" : "готово");
    this.registerView(VPS_SYNC_VIEW_TYPE, (leaf: WorkspaceLeaf) => new VpsSyncPanelView(leaf, this));
    this.addRibbonIcon("refresh-cw", "Открыть VPS Sync", () => void this.openPanel());
    this.engine = new SyncEngine(this.app, this.data, {
      save: () => this.savePluginData(),
      status: (message) => this.setStatus(message),
      log: (message, error) => console.error(`[VPS Sync] ${message}`, error ?? "")
    });

    this.addSettingTab(new VpsSyncSettingTab(this.app, this));
    this.addCommand({
      id: "open-panel",
      name: "Открыть боковую панель",
      callback: () => void this.openPanel()
    });
    this.addCommand({
      id: "sync-now",
      name: "Синхронизировать сейчас",
      callback: () => void this.openPanel().then(() => this.syncNow(true))
    });
    this.addCommand({
      id: "pause-or-resume",
      name: "Приостановить или включить синхронизацию",
      callback: () => void this.openPanel().then(() => this.togglePaused())
    });
    this.addCommand({
      id: "test-connection",
      name: "Проверить подключение к VPS",
      callback: () => void this.openPanel().then(() => this.testConnection())
    });

    this.registerEvent(this.app.vault.on("create", (file) => this.queueChangedVault(file.path)));
    this.registerEvent(this.app.vault.on("modify", (file) => this.queueChangedVault(file.path)));
    this.registerEvent(this.app.vault.on("delete", (file) => this.queueChangedVault(file.path)));
    this.registerEvent(this.app.vault.on("rename", (file) => this.queueChangedVault(file.path)));
    this.registerInterval(
      window.setInterval(() => {
        const settings = this.data.settings;
        if (settings.paused || !settings.initialised || this.engine.isRunning()) return;
        if (Date.now() - this.lastAutomaticRun >= settings.syncIntervalSeconds * 1000) {
          void this.syncNow(false);
        }
      }, 5_000)
    );

    if (this.data.settings.syncOnStart && this.data.settings.initialised && !this.data.settings.paused) {
      this.app.workspace.onLayoutReady(() => window.setTimeout(() => void this.syncNow(false), 1_000));
    }
  }

  onunload(): void {
    if (this.changeTimer !== undefined) window.clearTimeout(this.changeTimer);
    this.app.workspace.detachLeavesOfType(VPS_SYNC_VIEW_TYPE);
  }

  async savePluginData(): Promise<void> {
    this.saveQueue = this.saveQueue.catch(() => undefined).then(() => this.saveData(this.data));
    await this.saveQueue;
  }

  async testConnection(): Promise<void> {
    try {
      this.setStatus("проверка подключения");
      const message = await this.engine.testConnection();
      this.recordActivity("success", message);
      this.setStatus("готово");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordActivity("error", `Проверка подключения: ${message}`);
      this.setStatus("ошибка");
    }
  }

  async startInitialSync(mode: InitialMode): Promise<void> {
    this.data.settings.initialMode = mode;
    this.data.settings.initialised = false;
    this.data.settings.paused = false;
    await this.savePluginData();
    await this.syncNow(true);
  }

  async togglePaused(): Promise<void> {
    this.data.settings.paused = !this.data.settings.paused;
    await this.savePluginData();
    this.setStatus(this.data.settings.paused ? "приостановлено" : "готово");
    this.recordActivity("info", this.data.settings.paused ? "Синхронизация приостановлена" : "Синхронизация включена");
    if (!this.data.settings.paused && this.data.settings.initialised) await this.syncNow(false);
  }

  private queueChangedVault(path: string): void {
    if (this.data.settings.paused || !this.data.settings.initialised) return;
    const normalisedPath = path.replaceAll("\\", "/").replace(/\/$/u, "");
    const ownDirectory = this.manifest.dir?.replaceAll("\\", "/").replace(/\/$/u, "");
    if (ownDirectory && (normalisedPath === ownDirectory || normalisedPath.startsWith(`${ownDirectory}/`))) return;
    if (/^\.obsidian\/plugins\/vps-sync(?:[-_.][^/]*)?(?:\/|$)/iu.test(normalisedPath)) return;
    this.engine.markLocalDirty();
    if (this.changeTimer !== undefined) window.clearTimeout(this.changeTimer);
    this.changeTimer = window.setTimeout(() => {
      this.changeTimer = undefined;
      void this.syncNow(false);
    }, 2_000);
  }

  async syncNow(showResult: boolean): Promise<void> {
    this.lastAutomaticRun = Date.now();
    try {
      const report = await this.engine.sync();
      const queued = report.errors.length === 1 && report.errors[0].startsWith("Синхронизация уже выполняется");
      if (queued) {
        this.recordActivity("warning", report.errors[0]);
        return;
      }
      this.data.state.lastReport = report;
      await this.savePluginData();
      if (showResult || report.errors.length > 0 || report.conflicts > 0) {
        const level: ActivityLevel = report.errors.length > 0 ? "error" : report.conflicts > 0 ? "warning" : "success";
        this.recordActivity(level, describeReport(report));
      } else {
        this.refreshPanels();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[VPS Sync] Синхронизация прервана", error);
      this.data.state.lastErrors = [message];
      this.recordActivity("error", `Синхронизация прервана: ${message}`);
      this.setStatus("ошибка");
    }
  }

  getCurrentStatus(): string {
    return this.currentStatus;
  }

  private setStatus(message: string): void {
    this.currentStatus = message;
    for (const leaf of this.app.workspace.getLeavesOfType(VPS_SYNC_VIEW_TYPE)) {
      if (leaf.view instanceof VpsSyncPanelView) leaf.view.updateStatus(message);
    }
  }

  recordActivity(level: ActivityLevel, message: string): void {
    this.data.state.activityLog = appendActivity(this.data.state.activityLog, level, message);
    this.refreshPanels();
    void this.savePluginData().catch((error) => console.error("[VPS Sync] Не удалось сохранить журнал", error));
  }

  async copyErrors(): Promise<void> {
    const text = formatErrorReport(
      this.manifest.version,
      this.data.settings.deviceName,
      this.data.state.lastErrors,
      this.data.state.lastReport
    );
    await navigator.clipboard.writeText(text);
    this.recordActivity("success", "Отчёт об ошибках скопирован");
  }

  async copyActivityLog(): Promise<void> {
    const text = formatActivityLog(this.data.state.activityLog);
    await navigator.clipboard.writeText(text);
    this.recordActivity("success", "Журнал сообщений скопирован");
  }

  async clearActivityLog(): Promise<void> {
    this.data.state.activityLog = [];
    await this.savePluginData();
    this.refreshPanels();
  }

  async openPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VPS_SYNC_VIEW_TYPE)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      if (existing.view instanceof VpsSyncPanelView) existing.view.refresh();
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VPS_SYNC_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private refreshPanels(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VPS_SYNC_VIEW_TYPE)) {
      if (leaf.view instanceof VpsSyncPanelView) leaf.view.refresh();
    }
  }

  private async loadPluginData(): Promise<void> {
    const defaults = createDefaultData();
    const saved = (await this.loadData()) as Partial<PersistedData> | null;
    this.data = {
      settings: { ...defaults.settings, ...(saved?.settings ?? {}) },
      state: {
        ...defaults.state,
        ...(saved?.state ?? {}),
        files: { ...defaults.state.files, ...(saved?.state?.files ?? {}) },
        lastErrors: [...(saved?.state?.lastErrors ?? [])],
        activityLog: [...(saved?.state?.activityLog ?? [])].slice(-200)
      }
    };
    if (!saved?.settings?.deviceName || saved.settings.deviceName === "Устройство") {
      this.data.settings.deviceName = Platform.isMobileApp ? "iPhone" : "Компьютер";
    }
    await this.savePluginData();
  }
}

import { toArrayBuffer } from "./encoding";
import {
  createCryptoContext,
  decryptBytes,
  decryptJson,
  encryptBytes,
  encryptJson,
  keyedId,
  sha256,
  type CryptoContext
} from "./crypto";
import { CouchClient, CouchConflictError, CouchError } from "./couch";
import { LocalVault } from "./local-vault";
import { conflictPath, pathKey, PathRules } from "./path-rules";
import { buildActions, DELETED_TOKEN, remoteToken } from "./reconcile";
import type {
  LocalEntry,
  PersistedData,
  RemoteEntry,
  RemotePayload,
  SyncAction,
  SyncReport,
  SyncedFileState
} from "./types";
import type { App } from "obsidian";

interface EngineCallbacks {
  save: () => Promise<void>;
  status: (message: string) => void;
  log: (message: string, error?: unknown) => void;
}

function emptyReport(): SyncReport {
  const now = Date.now();
  return {
    startedAt: now,
    finishedAt: now,
    uploaded: 0,
    downloaded: 0,
    deletedLocal: 0,
    deletedRemote: 0,
    conflicts: 0,
    unchanged: 0,
    skipped: 0,
    errors: []
  };
}

export class SyncEngine {
  private running = false;
  private rerunRequested = false;
  private localDirty = true;
  private cryptoCache?: { signature: string; context: CryptoContext };

  constructor(
    private readonly app: App,
    private readonly data: PersistedData,
    private readonly callbacks: EngineCallbacks
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  requestAnotherRun(): void {
    this.rerunRequested = true;
  }

  markLocalDirty(): void {
    this.localDirty = true;
  }

  async testConnection(): Promise<string> {
    this.validateSettings();
    const client = this.createClient();
    const info = await client.ensureDatabase();
    await this.prepareCrypto(client);
    return `Подключение установлено. База: ${info.db_name}`;
  }

  async sync(): Promise<SyncReport> {
    if (this.running) {
      this.rerunRequested = true;
      const report = emptyReport();
      report.errors.push("Синхронизация уже выполняется; новый запуск поставлен в очередь");
      return report;
    }
    this.running = true;
    this.rerunRequested = false;
    let report = emptyReport();
    try {
      report = await this.runOnce();
    } finally {
      this.running = false;
      this.callbacks.status(this.data.settings.paused ? "приостановлено" : "готово");
    }
    if (this.rerunRequested && !this.data.settings.paused) {
      this.rerunRequested = false;
      window.setTimeout(() => void this.sync(), 250);
    }
    return report;
  }

  private async runOnce(): Promise<SyncReport> {
    this.validateSettings();
    const report = emptyReport();
    const client = this.createClient();
    const rules = new PathRules(this.data.settings.extraExcludedPatterns);
    const localVault = new LocalVault(this.app, rules, this.data.settings.maxFileSizeMb * 1024 * 1024);

    this.callbacks.status("проверка сервера");
    const initialInfo = await client.ensureDatabase();
    const context = await this.prepareCrypto(client);
    const serverUnchanged = String(initialInfo.update_seq) === this.data.state.lastServerSequence;
    const scanStillFresh = Date.now() - this.data.state.lastFullScanAt < this.data.settings.scanIntervalSeconds * 1000;
    if (this.data.settings.initialised && !this.localDirty && serverUnchanged && scanStillFresh) {
      report.finishedAt = Date.now();
      report.unchanged = 1;
      return report;
    }
    this.callbacks.status("сканирование хранилища");
    const localScan = await localVault.scan(this.data.state.files);
    report.skipped = localScan.skipped.length;
    if (localScan.skipped.length > 0) {
      this.callbacks.log(`Пропущены слишком большие файлы: ${localScan.skipped.join(", ")}`);
    }
    if (localScan.renamedCaseCollisions.length > 0) {
      report.conflicts += localScan.renamedCaseCollisions.length;
      this.callbacks.log(
        `Автоматически переименованы пути, различавшиеся только регистром: ${localScan.renamedCaseCollisions.join(", ")}`
      );
    }

    this.callbacks.status("получение списка изменений");
    const remoteEntries = await client.fetchManifest(context);
    const actions = buildActions(
      localScan.entries,
      remoteEntries,
      this.data.state.files,
      this.data.settings.initialised ? "merge" : this.data.settings.initialMode
    );

    let completedSinceSave = 0;
    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      this.callbacks.status(`${index + 1}/${actions.length}: ${this.actionPath(action)}`);
      try {
        await this.executeAction(action, client, localVault, context, report, remoteEntries, localScan.entries);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        report.errors.push(`${this.actionPath(action)}: ${message}`);
        this.callbacks.log(`Ошибка синхронизации ${this.actionPath(action)}`, error);
        if (error instanceof CouchConflictError) {
          this.rerunRequested = true;
          break;
        }
        if (error instanceof CouchError) break;
      }
      completedSinceSave += 1;
      if (completedSinceSave >= 20) {
        await this.callbacks.save();
        completedSinceSave = 0;
      }
    }

    const info = await client.info();
    this.data.state.lastServerSequence = String(info.update_seq);
    this.data.state.lastFullScanAt = Date.now();
    if (report.errors.length === 0) {
      this.data.settings.initialised = true;
      this.data.settings.initialMode = "merge";
      this.localDirty = false;
    }
    report.finishedAt = Date.now();
    this.data.state.lastErrors = report.errors.slice(0, 500);
    await this.callbacks.save();
    return report;
  }

  private async executeAction(
    action: SyncAction,
    client: CouchClient,
    localVault: LocalVault,
    context: CryptoContext,
    report: SyncReport,
    remoteEntries: Map<string, RemoteEntry>,
    localEntries: Map<string, LocalEntry>
  ): Promise<void> {
    if (action.type === "equal") {
      const remote = remoteEntries.get(action.pathKey);
      const local = localEntries.get(action.pathKey);
      const state = this.data.state.files[action.pathKey];
      if (remote) {
        this.recordState(
          action.pathKey,
          remoteToken(remote),
          remote.path,
          remote.kind,
          local?.mtime ?? remote.mtime,
          local?.size ?? remote.size,
          remote.rev
        );
      } else if (state) {
        state.token = DELETED_TOKEN;
        state.localMtime = 0;
        state.localSize = 0;
      }
      report.unchanged += 1;
      return;
    }
    if (action.type === "upload") {
      const uploaded = await this.uploadEntry(client, localVault, context, action.local, action.remote);
      remoteEntries.set(action.pathKey, uploaded);
      this.recordState(
        action.pathKey,
        remoteToken(uploaded),
        action.local.path,
        action.local.kind,
        uploaded.mtime,
        uploaded.size,
        uploaded.rev
      );
      report.uploaded += 1;
      return;
    }
    if (action.type === "upload-delete") {
      const uploaded = await this.uploadDeletion(client, context, action.previous, action.remote);
      remoteEntries.set(action.pathKey, uploaded);
      this.recordState(action.pathKey, DELETED_TOKEN, uploaded.path, uploaded.kind, 0, 0, uploaded.rev);
      report.deletedRemote += 1;
      return;
    }
    if (action.type === "download") {
      await this.downloadEntry(client, localVault, context, action.remote);
      this.recordRemoteAsLocal(action.remote, await localVault.stat(action.remote.path));
      report.downloaded += 1;
      return;
    }
    if (action.type === "delete-local") {
      await localVault.remove(action.local.path);
      this.recordState(action.pathKey, DELETED_TOKEN, action.remote.path, action.remote.kind, 0, 0, action.remote.rev);
      report.deletedLocal += 1;
      return;
    }

    const target = conflictPath(action.local.path, this.data.settings.deviceName);
    await localVault.moveToConflict(action.local.path, target);
    if (!action.remote.deleted) {
      await this.downloadEntry(client, localVault, context, action.remote);
      this.recordRemoteAsLocal(action.remote, await localVault.stat(action.remote.path));
      report.downloaded += 1;
    } else {
      this.recordState(action.pathKey, DELETED_TOKEN, action.remote.path, action.remote.kind, 0, 0, action.remote.rev);
    }
    report.conflicts += 1;
    this.rerunRequested = true;
  }

  private async uploadEntry(
    client: CouchClient,
    localVault: LocalVault,
    context: CryptoContext,
    local: LocalEntry,
    expectedRemote?: RemoteEntry
  ): Promise<RemoteEntry> {
    const payload: RemotePayload = {
      schema: 1,
      path: local.path,
      pathKey: local.pathKey,
      kind: local.kind,
      deleted: false,
      size: local.size,
      mtime: local.mtime,
      deviceId: this.data.settings.deviceId,
      deviceName: this.data.settings.deviceName,
      updatedAt: Date.now()
    };
    if (local.kind === "file") {
      const beforeRead = await localVault.stat(local.path);
      const bytes = await localVault.read(local.path);
      const hash = await sha256(toArrayBuffer(bytes));
      const afterRead = await localVault.stat(local.path);
      const stableRead =
        beforeRead?.type === "file" &&
        afterRead?.type === "file" &&
        beforeRead.mtime === afterRead.mtime &&
        beforeRead.size === afterRead.size;
      payload.size = bytes.byteLength;
      payload.mtime = stableRead ? afterRead.mtime : (beforeRead?.mtime ?? local.mtime);
      const encrypted = await encryptBytes(context, bytes);
      const blobKey = await keyedId(context, "blob", `v2:${hash}:${encrypted.iv}`);
      const chunks = await client.uploadBlob(blobKey, encrypted.data, this.data.settings.chunkSizeKb * 1024);
      payload.contentHash = hash;
      payload.blobKey = blobKey;
      payload.chunks = chunks;
      payload.contentIv = encrypted.iv;
      payload.blobVersion = 2;
    }
    return client.putHead(context, payload, expectedRemote);
  }

  private async uploadDeletion(
    client: CouchClient,
    context: CryptoContext,
    previous: SyncedFileState,
    expectedRemote?: RemoteEntry
  ): Promise<RemoteEntry> {
    const payload: RemotePayload = {
      schema: 1,
      path: previous.path,
      pathKey: pathKey(previous.path),
      kind: previous.kind,
      deleted: true,
      size: 0,
      mtime: Date.now(),
      deviceId: this.data.settings.deviceId,
      deviceName: this.data.settings.deviceName,
      updatedAt: Date.now()
    };
    return client.putHead(context, payload, expectedRemote);
  }

  private async downloadEntry(
    client: CouchClient,
    localVault: LocalVault,
    context: CryptoContext,
    remote: RemoteEntry
  ): Promise<void> {
    if (remote.deleted) return;
    if (remote.kind === "folder") {
      await localVault.ensureFolder(remote.path);
      return;
    }
    if (!remote.blobKey || !remote.chunks || !remote.contentIv || !remote.contentHash) {
      throw new Error("Серверное описание файла неполно");
    }
    const encryptedData = await client.downloadBlob(remote.blobKey, remote.chunks);
    const bytes = await decryptBytes(context, { iv: remote.contentIv, data: encryptedData });
    const actualHash = await sha256(toArrayBuffer(bytes));
    if (actualHash !== remote.contentHash) throw new Error("Контрольная сумма загруженного файла не совпала");
    await localVault.write(remote.path, bytes, remote.mtime);
  }

  private recordRemoteAsLocal(remote: RemoteEntry, stat: { mtime: number; size: number } | null): void {
    this.recordState(
      remote.pathKey,
      remoteToken(remote),
      remote.path,
      remote.kind,
      stat?.mtime ?? remote.mtime,
      stat?.size ?? remote.size,
      remote.rev
    );
  }

  private recordState(
    key: string,
    token: string,
    path: string,
    kind: "file" | "folder",
    localMtime: number,
    localSize: number,
    remoteRev?: string
  ): void {
    this.data.state.files[key] = { path, kind, token, localMtime, localSize, remoteRev };
  }

  private createClient(): CouchClient {
    const settings = this.data.settings;
    return new CouchClient(settings.serverUrl, settings.database, settings.username, settings.password);
  }

  private async cryptoContext(): Promise<CryptoContext> {
    const settings = this.data.settings;
    const signature = `${settings.encryptionSalt}\u0000${settings.encryptionPassphrase}`;
    if (this.cryptoCache?.signature === signature) return this.cryptoCache.context;
    const context = await createCryptoContext(settings.encryptionPassphrase, settings.encryptionSalt);
    this.cryptoCache = { signature, context };
    return context;
  }

  private async prepareCrypto(client: CouchClient): Promise<CryptoContext> {
    let config = await client.fetchVaultConfig();
    if (!config) {
      const context = await this.cryptoContext();
      if (await client.hasHeadDocuments()) {
        try {
          await client.fetchManifest(context);
        } catch {
          throw new Error(
            "Старая база не содержит резервной соли, а текущими паролем и солью её расшифровать не удалось"
          );
        }
      }
      config = await client.putVaultConfig({
        type: "config",
        schema: 1,
        encryptionSalt: this.data.settings.encryptionSalt,
        verifier: await encryptJson(context, { marker: "vps-sync", schema: 1 }),
        createdAt: Date.now()
      });
    }

    if (config.encryptionSalt !== this.data.settings.encryptionSalt) {
      this.data.settings.encryptionSalt = config.encryptionSalt;
      this.cryptoCache = undefined;
      await this.callbacks.save();
    }

    const context = await this.cryptoContext();
    let verifier: { marker?: string; schema?: number };
    try {
      verifier = await decryptJson<{ marker?: string; schema?: number }>(context, config.verifier);
    } catch {
      throw new Error("Неверный пароль шифрования для этой базы");
    }
    if (verifier.marker !== "vps-sync" || verifier.schema !== 1) {
      throw new Error("Служебная запись шифрования повреждена");
    }
    return context;
  }

  private validateSettings(): void {
    const settings = this.data.settings;
    if (!/^https:\/\//iu.test(settings.serverUrl)) throw new Error("Адрес сервера должен начинаться с https://");
    if (!settings.database.trim()) throw new Error("Не указано имя базы CouchDB");
    if (!settings.username.trim() || !settings.password) throw new Error("Не указаны имя пользователя или пароль CouchDB");
    if (!settings.encryptionSalt) throw new Error("Не создана соль шифрования");
    if (settings.encryptionPassphrase.length < 12) throw new Error("Пароль шифрования должен содержать не менее 12 символов");
  }

  private actionPath(action: SyncAction): string {
    if ("local" in action && action.local) return action.local.path;
    if ("remote" in action && action.remote) return action.remote.path;
    if ("previous" in action) return action.previous.path;
    return action.pathKey;
  }
}

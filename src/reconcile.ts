import type {
  InitialMode,
  LocalEntry,
  RemoteEntry,
  SyncAction,
  SyncedFileState
} from "./types";

export const DELETED_TOKEN = "deleted";
export const FOLDER_TOKEN = "folder";

export function localToken(entry: LocalEntry | undefined): string {
  if (!entry) return DELETED_TOKEN;
  if (entry.kind === "folder") return FOLDER_TOKEN;
  if (!entry.hash) throw new Error(`Не вычислена контрольная сумма файла: ${entry.path}`);
  return `file:${entry.hash}`;
}

export function remoteToken(entry: RemoteEntry | undefined): string {
  if (!entry || entry.deleted) return DELETED_TOKEN;
  if (entry.kind === "folder") return FOLDER_TOKEN;
  if (!entry.contentHash) throw new Error(`На сервере отсутствует контрольная сумма файла: ${entry.path}`);
  return `file:${entry.contentHash}`;
}

function isMirroredPluginPath(key: string): boolean {
  return key.startsWith(".obsidian/plugins/") && !key.startsWith(".obsidian/plugins/vps-sync/");
}

function missingRemotePlugin(local: LocalEntry): RemoteEntry {
  return {
    schema: 1,
    id: "",
    rev: "",
    path: local.path,
    pathKey: local.pathKey,
    kind: local.kind,
    deleted: true,
    size: 0,
    mtime: Date.now(),
    deviceId: "",
    deviceName: "",
    updatedAt: Date.now()
  };
}

function firstSyncAction(
  pathKey: string,
  local: LocalEntry | undefined,
  remote: RemoteEntry | undefined,
  mode: InitialMode
): SyncAction {
  const hasLocal = local !== undefined;
  const hasRemote = remote !== undefined && !remote.deleted;

  if (!hasLocal && !hasRemote) return { type: "equal", pathKey };
  if (hasLocal && !hasRemote) return { type: "upload", pathKey, local, remote };
  if (!hasLocal && hasRemote) return { type: "download", pathKey, remote };
  if (!local || !remote) return { type: "equal", pathKey };
  if (localToken(local) === remoteToken(remote)) return { type: "equal", pathKey };
  if (mode === "prefer-local") return { type: "upload", pathKey, local, remote };
  if (mode === "prefer-remote") return { type: "download", pathKey, remote, local };
  return { type: "conflict", pathKey, local, remote };
}

export function decideAction(
  pathKey: string,
  local: LocalEntry | undefined,
  remote: RemoteEntry | undefined,
  previous: SyncedFileState | undefined,
  mode: InitialMode
): SyncAction {
  if (
    mode === "prefer-local" &&
    local?.kind === "file" &&
    remote?.kind === "file" &&
    !remote.deleted &&
    remote.blobVersion !== 2
  ) {
    return { type: "upload", pathKey, local, remote };
  }

  // During the first download to a secondary device, the server is the source
  // of truth specifically for installed plug-in folders. Local plug-ins that
  // are absent on the source device are removed. Ordinary notes and other
  // vault files keep the safer merge behaviour.
  if (
    !previous &&
    mode === "prefer-remote" &&
    local &&
    (!remote || remote.deleted) &&
    isMirroredPluginPath(pathKey)
  ) {
    return { type: "delete-local", pathKey, remote: remote ?? missingRemotePlugin(local), local };
  }
  if (!previous) return firstSyncAction(pathKey, local, remote, mode);

  // A missing head document is not a deletion. VPS Sync represents deletions
  // with explicit tombstones. If a database was recreated or partially lost,
  // restore it from the local copy instead of deleting local user data.
  if (!remote) {
    if (local) return { type: "upload", pathKey, local };
    return { type: "equal", pathKey };
  }

  const base = previous.token;
  const currentLocal = localToken(local);
  const currentRemote = remoteToken(remote);

  if (currentLocal === currentRemote) return { type: "equal", pathKey };
  if (currentLocal === base && currentRemote !== base) {
    if (!remote || remote.deleted) {
      if (!local) return { type: "equal", pathKey };
      return { type: "delete-local", pathKey, remote: remote ?? tombstoneFromState(previous), local };
    }
    return { type: "download", pathKey, remote, local };
  }
  if (currentRemote === base && currentLocal !== base) {
    if (!local) return { type: "upload-delete", pathKey, previous, remote };
    return { type: "upload", pathKey, local, remote };
  }

  if (!local && remote && !remote.deleted) {
    return { type: "download", pathKey, remote };
  }
  if (local && (!remote || remote.deleted)) {
    if (currentLocal === base) {
      return { type: "delete-local", pathKey, remote: remote ?? tombstoneFromState(previous), local };
    }
    return { type: "conflict", pathKey, local, remote: remote ?? tombstoneFromState(previous) };
  }
  if (local && remote) return { type: "conflict", pathKey, local, remote };
  return { type: "equal", pathKey };
}

function tombstoneFromState(previous: SyncedFileState): RemoteEntry {
  return {
    schema: 1,
    id: "",
    rev: previous.remoteRev ?? "",
    path: previous.path,
    pathKey: previous.path.toLocaleLowerCase("en-US"),
    kind: previous.kind,
    deleted: true,
    size: 0,
    mtime: Date.now(),
    deviceId: "",
    deviceName: "",
    updatedAt: Date.now()
  };
}

export function buildActions(
  localEntries: Map<string, LocalEntry>,
  remoteEntries: Map<string, RemoteEntry>,
  previousFiles: Record<string, SyncedFileState>,
  mode: InitialMode
): SyncAction[] {
  const keys = new Set([...localEntries.keys(), ...remoteEntries.keys(), ...Object.keys(previousFiles)]);
  return [...keys]
    .map((key) => decideAction(key, localEntries.get(key), remoteEntries.get(key), previousFiles[key], mode))
    .sort((left, right) => {
      const leftDepth = left.pathKey.split("/").length;
      const rightDepth = right.pathKey.split("/").length;
      const leftDeletes = left.type === "delete-local" || left.type === "upload-delete";
      const rightDeletes = right.type === "delete-local" || right.type === "upload-delete";
      if (leftDeletes !== rightDeletes) return leftDeletes ? -1 : 1;
      if (leftDeletes && rightDeletes) return rightDepth - leftDepth;
      return leftDepth - rightDepth;
    });
}

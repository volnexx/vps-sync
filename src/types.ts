export type EntryKind = "file" | "folder";
export type InitialMode = "merge" | "prefer-local" | "prefer-remote";

export interface VpsSyncSettings {
  serverUrl: string;
  database: string;
  username: string;
  password: string;
  encryptionPassphrase: string;
  encryptionSalt: string;
  deviceId: string;
  deviceName: string;
  syncIntervalSeconds: number;
  scanIntervalSeconds: number;
  maxFileSizeMb: number;
  chunkSizeKb: number;
  syncOnStart: boolean;
  paused: boolean;
  initialised: boolean;
  initialMode: InitialMode;
  extraExcludedPatterns: string[];
}

export interface SyncedFileState {
  path: string;
  kind: EntryKind;
  token: string;
  localMtime: number;
  localSize: number;
  remoteRev?: string;
}

export type ActivityLevel = "info" | "success" | "warning" | "error";

export interface ActivityLogEntry {
  timestamp: number;
  level: ActivityLevel;
  message: string;
  count: number;
}

export interface SyncState {
  schema: 1;
  files: Record<string, SyncedFileState>;
  lastServerSequence: string;
  lastFullScanAt: number;
  lastErrors: string[];
  activityLog: ActivityLogEntry[];
  lastReport?: SyncReport;
}

export interface PersistedData {
  settings: VpsSyncSettings;
  state: SyncState;
}

export interface LocalEntry {
  path: string;
  pathKey: string;
  kind: EntryKind;
  size: number;
  mtime: number;
  hash?: string;
}

export interface RemotePayload {
  schema: 1;
  path: string;
  pathKey: string;
  kind: EntryKind;
  deleted: boolean;
  contentHash?: string;
  blobKey?: string;
  chunks?: number;
  contentIv?: string;
  blobVersion?: 2;
  size: number;
  mtime: number;
  deviceId: string;
  deviceName: string;
  updatedAt: number;
}

export interface RemoteEntry extends RemotePayload {
  id: string;
  rev: string;
}

export interface EncryptedValue {
  iv: string;
  data: string;
}

export interface HeadDocument {
  _id: string;
  _rev?: string;
  type: "head";
  value: EncryptedValue;
}

export interface BlobDocument {
  _id: string;
  _rev?: string;
  type: "blob";
  data: string;
}

export interface VaultConfigDocument {
  _id: "config:vps-sync";
  _rev?: string;
  type: "config";
  schema: 1;
  encryptionSalt: string;
  verifier: EncryptedValue;
  createdAt: number;
}

export type SyncAction =
  | { type: "equal"; pathKey: string }
  | { type: "upload"; pathKey: string; local: LocalEntry; remote?: RemoteEntry }
  | { type: "upload-delete"; pathKey: string; previous: SyncedFileState; remote?: RemoteEntry }
  | { type: "download"; pathKey: string; remote: RemoteEntry; local?: LocalEntry }
  | { type: "delete-local"; pathKey: string; remote: RemoteEntry; local: LocalEntry }
  | { type: "conflict"; pathKey: string; local: LocalEntry; remote: RemoteEntry };

export interface SyncReport {
  startedAt: number;
  finishedAt: number;
  uploaded: number;
  downloaded: number;
  deletedLocal: number;
  deletedRemote: number;
  conflicts: number;
  unchanged: number;
  skipped: number;
  errors: string[];
}

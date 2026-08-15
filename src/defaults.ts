import type { PersistedData, VpsSyncSettings } from "./types";
import { createSalt } from "./crypto";

export const DEFAULT_EXCLUDED_PATTERNS = [
  ".git/**",
  ".git",
  ".trash/**",
  ".trash",
  ".DS_Store",
  "Thumbs.db",
  ".obsidian/workspace.json",
  ".obsidian/workspace-mobile.json",
  ".obsidian/community-plugins.json",
  ".obsidian/plugins/vps-sync*/**",
  ".obsidian/plugins/vps-sync*"
];

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createDefaultSettings(): VpsSyncSettings {
  return {
    serverUrl: "",
    database: "vps-sync",
    username: "",
    password: "",
    encryptionPassphrase: "",
    encryptionSalt: createSalt(),
    deviceId: randomId(),
    deviceName: "Устройство",
    syncIntervalSeconds: 30,
    scanIntervalSeconds: 300,
    maxFileSizeMb: 32,
    chunkSizeKb: 512,
    syncOnStart: true,
    paused: true,
    initialised: false,
    initialMode: "merge",
    extraExcludedPatterns: []
  };
}

export function createDefaultData(): PersistedData {
  return {
    settings: createDefaultSettings(),
    state: {
      schema: 1,
      files: {},
      lastServerSequence: "",
      lastFullScanAt: 0,
      lastErrors: [],
      activityLog: []
    }
  };
}

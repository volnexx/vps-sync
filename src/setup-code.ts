import { base64ToBytes, bytesToBase64, decodeUtf8, toArrayBuffer, utf8 } from "./encoding";
import type { VpsSyncSettings } from "./types";

interface SetupCode {
  schema: 1;
  serverUrl: string;
  database: string;
  username: string;
  password: string;
  encryptionPassphrase: string;
  encryptionSalt: string;
  chunkSizeKb: number;
  maxFileSizeMb: number;
}

export function exportSetupCode(settings: VpsSyncSettings): string {
  const value: SetupCode = {
    schema: 1,
    serverUrl: settings.serverUrl,
    database: settings.database,
    username: settings.username,
    password: settings.password,
    encryptionPassphrase: settings.encryptionPassphrase,
    encryptionSalt: settings.encryptionSalt,
    chunkSizeKb: settings.chunkSizeKb,
    maxFileSizeMb: settings.maxFileSizeMb
  };
  return `VPSSYNC1:${bytesToBase64(utf8(JSON.stringify(value)))}`;
}

export function importSetupCode(code: string, current: VpsSyncSettings): VpsSyncSettings {
  const trimmed = code.trim();
  if (!trimmed.startsWith("VPSSYNC1:")) throw new Error("Это не код подключения VPS Sync");
  const json = decodeUtf8(toArrayBuffer(base64ToBytes(trimmed.slice("VPSSYNC1:".length))));
  const value = JSON.parse(json) as Partial<SetupCode>;
  if (value.schema !== 1) throw new Error("Версия кода подключения не поддерживается");
  if (!value.serverUrl || !value.database || !value.username || !value.password || !value.encryptionPassphrase || !value.encryptionSalt) {
    throw new Error("Код подключения неполон");
  }
  return {
    ...current,
    serverUrl: value.serverUrl,
    database: value.database,
    username: value.username,
    password: value.password,
    encryptionPassphrase: value.encryptionPassphrase,
    encryptionSalt: value.encryptionSalt,
    chunkSizeKb: value.chunkSizeKb ?? current.chunkSizeKb,
    maxFileSizeMb: value.maxFileSizeMb ?? current.maxFileSizeMb
  };
}

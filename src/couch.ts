import { requestUrl, type RequestUrlParam } from "obsidian";
import { base64ToBytes, bytesToBase64, concatBytes, utf8 } from "./encoding";
import { decryptJson, encryptJson, keyedId, type CryptoContext } from "./crypto";
import type { BlobDocument, HeadDocument, RemoteEntry, RemotePayload, VaultConfigDocument } from "./types";

const VAULT_CONFIG_ID = "config:vps-sync";

interface CouchInfo {
  db_name: string;
  update_seq: string | number;
  doc_count?: number;
}

interface CouchRow<T> {
  id: string;
  key: string;
  value: { rev?: string; error?: string };
  doc?: T;
  error?: string;
}

interface AllDocsResponse<T> {
  rows: CouchRow<T>[];
}

interface PutResponse {
  ok: boolean;
  id: string;
  rev: string;
}

interface RequestResponse {
  status: number;
  json: unknown;
  text: string;
}

type Requester = (request: RequestUrlParam) => Promise<RequestResponse>;

export class CouchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseText: string
  ) {
    super(message);
  }
}

export class CouchConflictError extends CouchError {}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

export class CouchClient {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly serverUrl: string,
    private readonly database: string,
    private readonly username: string,
    private readonly password: string,
    private readonly requester: Requester = requestUrl
  ) {}

  private databaseUrl(path = ""): string {
    const base = stripTrailingSlash(this.serverUrl);
    return `${base}/${encodeURIComponent(this.database)}${path}`;
  }

  private authorisation(): string {
    return `Basic ${bytesToBase64(utf8(`${this.username}:${this.password}`))}`;
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    acceptedStatuses: number[] = [200, 201, 202]
  ): Promise<T> {
    return this.serial(async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const response = await this.requester({
            url: this.databaseUrl(path),
            method,
            headers: {
              Authorization: this.authorisation(),
              Accept: "application/json"
            },
            contentType: "application/json",
            body: body === undefined ? undefined : JSON.stringify(body),
            throw: false
          });
          if (acceptedStatuses.includes(response.status)) return response.json as T;
          if (response.status === 409) {
            throw new CouchConflictError("Серверная версия файла изменилась во время синхронизации", 409, response.text);
          }
          if (response.status >= 500 || response.status === 408 || response.status === 429) {
            throw new CouchError(`Временная ошибка CouchDB: HTTP ${response.status}`, response.status, response.text);
          }
          throw new CouchError(`Запрос CouchDB отклонён: HTTP ${response.status}`, response.status, response.text);
        } catch (error) {
          lastError = error;
          if (error instanceof CouchConflictError) throw error;
          if (error instanceof CouchError && error.status > 0 && error.status < 500 && error.status !== 408 && error.status !== 429) {
            throw error;
          }
          if (attempt < 3) await wait(750 * 2 ** attempt);
        }
      }
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      throw new CouchError(`Сетевой запрос не выполнен после четырёх попыток: ${message}`, 0, "");
    });
  }

  async ensureDatabase(): Promise<CouchInfo> {
    try {
      return await this.request<CouchInfo>("GET", "");
    } catch (error) {
      if (!(error instanceof CouchError) || error.status !== 404) throw error;
      await this.request<{ ok: boolean }>("PUT", "", undefined, [201, 202]);
      return this.request<CouchInfo>("GET", "");
    }
  }

  async info(): Promise<CouchInfo> {
    return this.request<CouchInfo>("GET", "");
  }

  async fetchVaultConfig(): Promise<VaultConfigDocument | null> {
    try {
      return await this.request<VaultConfigDocument>("GET", `/${encodeURIComponent(VAULT_CONFIG_ID)}`);
    } catch (error) {
      if (error instanceof CouchError && error.status === 404) return null;
      throw error;
    }
  }

  async putVaultConfig(document: Omit<VaultConfigDocument, "_id">): Promise<VaultConfigDocument> {
    const value: VaultConfigDocument = { _id: VAULT_CONFIG_ID, ...document };
    try {
      const response = await this.request<PutResponse>("PUT", `/${encodeURIComponent(VAULT_CONFIG_ID)}`, value);
      return { ...value, _rev: response.rev };
    } catch (error) {
      if (!(error instanceof CouchConflictError)) throw error;
      const existing = await this.fetchVaultConfig();
      if (!existing) throw error;
      return existing;
    }
  }

  async hasHeadDocuments(): Promise<boolean> {
    const startKey = encodeURIComponent(JSON.stringify("head:"));
    const endKey = encodeURIComponent(JSON.stringify("head:\ufff0"));
    const response = await this.request<AllDocsResponse<HeadDocument>>(
      "GET",
      `/_all_docs?limit=1&startkey=${startKey}&endkey=${endKey}`
    );
    return response.rows.length > 0;
  }

  async fetchManifest(context: CryptoContext): Promise<Map<string, RemoteEntry>> {
    const startKey = encodeURIComponent(JSON.stringify("head:"));
    const endKey = encodeURIComponent(JSON.stringify("head:\ufff0"));
    const response = await this.request<AllDocsResponse<HeadDocument>>(
      "GET",
      `/_all_docs?include_docs=true&limit=10000&startkey=${startKey}&endkey=${endKey}`
    );
    const entries = new Map<string, RemoteEntry>();
    for (const row of response.rows) {
      if (!row.doc || row.doc.type !== "head" || !row.doc._rev) continue;
      const payload = await decryptJson<RemotePayload>(context, row.doc.value);
      const existing = entries.get(payload.pathKey);
      if (existing && existing.id !== row.doc._id) {
        throw new Error(`Сервер содержит два пути, различающиеся только регистром: ${existing.path} и ${payload.path}`);
      }
      entries.set(payload.pathKey, {
        ...payload,
        id: row.doc._id,
        rev: row.doc._rev
      });
    }
    return entries;
  }

  async putHead(
    context: CryptoContext,
    payload: RemotePayload,
    expectedRemote?: RemoteEntry
  ): Promise<RemoteEntry> {
    const id = `head:${await keyedId(context, "path", payload.pathKey)}`;
    const document: HeadDocument = {
      _id: id,
      type: "head",
      value: await encryptJson(context, payload)
    };
    if (expectedRemote?.rev) document._rev = expectedRemote.rev;
    const response = await this.request<PutResponse>("PUT", `/${encodeURIComponent(id)}`, document);
    return { ...payload, id: response.id, rev: response.rev };
  }

  async uploadBlob(blobKey: string, encryptedBase64: string, chunkSizeBytes: number): Promise<number> {
    const bytes = base64ToBytes(encryptedBase64);
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < bytes.length; offset += chunkSizeBytes) {
      chunks.push(bytes.subarray(offset, Math.min(offset + chunkSizeBytes, bytes.length)));
    }
    if (chunks.length === 0) chunks.push(new Uint8Array());
    const ids = chunks.map((_, index) => this.blobDocumentId(blobKey, index));
    const existing = await this.request<AllDocsResponse<BlobDocument>>("POST", "/_all_docs", { keys: ids });
    const existingIds = new Set(existing.rows.filter((row) => !row.error && !row.value.error).map((row) => row.id));
    const missing: BlobDocument[] = chunks
      .map((chunk, index) => ({
        _id: ids[index],
        type: "blob" as const,
        data: bytesToBase64(chunk)
      }))
      .filter((document) => !existingIds.has(document._id));

    for (let index = 0; index < missing.length; index += 8) {
      const batch = missing.slice(index, index + 8);
      const results = await this.request<Array<{ ok?: boolean; error?: string; reason?: string }>>(
        "POST",
        "/_bulk_docs",
        { docs: batch }
      );
      const failed = results.find((result) => !result.ok && result.error !== "conflict");
      if (failed) throw new Error(`Не удалось сохранить часть файла: ${failed.error ?? "неизвестная ошибка"}`);
    }
    return chunks.length;
  }

  async downloadBlob(blobKey: string, chunkCount: number): Promise<string> {
    const ids = Array.from({ length: chunkCount }, (_, index) => this.blobDocumentId(blobKey, index));
    const chunks: Uint8Array[] = [];
    for (let index = 0; index < ids.length; index += 16) {
      const batchIds = ids.slice(index, index + 16);
      const response = await this.request<AllDocsResponse<BlobDocument>>("POST", "/_all_docs?include_docs=true", {
        keys: batchIds
      });
      for (const row of response.rows) {
        if (!row.doc || row.doc.type !== "blob") throw new Error(`На сервере отсутствует часть файла: ${row.key}`);
        chunks.push(base64ToBytes(row.doc.data));
      }
    }
    return bytesToBase64(concatBytes(chunks));
  }

  private blobDocumentId(blobKey: string, index: number): string {
    return `blob:${blobKey}:${index.toString().padStart(6, "0")}`;
  }
}

import type { RequestUrlParam } from "obsidian";
import { describe, expect, it } from "vitest";
import { CouchClient } from "../src/couch";
import { createCryptoContext, decryptBytes, encryptBytes, keyedId, sha256 } from "../src/crypto";
import { toArrayBuffer, utf8 } from "../src/encoding";
import type { RemotePayload } from "../src/types";

interface StoredDocument {
  _id: string;
  _rev: string;
  type: "head" | "blob" | "config";
  [key: string]: unknown;
}

class FakeCouch {
  private readonly documents = new Map<string, StoredDocument>();
  private sequence = 0;

  request = async (request: RequestUrlParam) => {
    const url = new URL(request.url);
    const suffix = url.pathname.replace(/^\/test/u, "");
    const body = typeof request.body === "string" ? (JSON.parse(request.body) as Record<string, unknown>) : undefined;

    if (request.method === "GET" && suffix === "") {
      return this.response(200, { db_name: "test", update_seq: this.sequence, doc_count: this.documents.size });
    }
    if (request.method === "GET" && suffix.startsWith("/_all_docs")) {
      const startKey = JSON.parse(url.searchParams.get("startkey") ?? '""') as string;
      const endKey = JSON.parse(url.searchParams.get("endkey") ?? '"\uffff"') as string;
      const rows = [...this.documents.values()]
        .filter((document) => document._id >= startKey && document._id <= endKey)
        .slice(0, Number(url.searchParams.get("limit") ?? "10000"))
        .map((document) => this.row(document));
      return this.response(200, { rows });
    }
    if (request.method === "GET" && suffix.startsWith("/")) {
      const id = decodeURIComponent(suffix.slice(1));
      const document = this.documents.get(id);
      return document ? this.response(200, document) : this.response(404, { error: "not_found" });
    }
    if (request.method === "POST" && suffix.startsWith("/_all_docs")) {
      const keys = body?.keys as string[];
      return this.response(200, {
        rows: keys.map((id) => {
          const document = this.documents.get(id);
          return document ? this.row(document) : { key: id, error: "not_found" };
        })
      });
    }
    if (request.method === "POST" && suffix === "/_bulk_docs") {
      const documents = body?.docs as StoredDocument[];
      const results = documents.map((document) => {
        if (this.documents.has(document._id)) return { id: document._id, error: "conflict" };
        const stored = this.store(document);
        return { id: stored._id, rev: stored._rev, ok: true };
      });
      return this.response(201, results);
    }
    if (request.method === "PUT" && suffix.startsWith("/")) {
      const id = decodeURIComponent(suffix.slice(1));
      const document = { ...(body as StoredDocument), _id: id };
      const existing = this.documents.get(id);
      if (existing && document._rev !== existing._rev) return this.response(409, { error: "conflict" });
      const stored = this.store(document);
      return this.response(201, { ok: true, id, rev: stored._rev });
    }
    return this.response(404, { error: "not_found" });
  };

  private store(document: StoredDocument): StoredDocument {
    this.sequence += 1;
    const stored = { ...document, _rev: `${this.sequence}-test` };
    this.documents.set(stored._id, stored);
    return stored;
  }

  private row(document: StoredDocument): Record<string, unknown> {
    return { id: document._id, key: document._id, value: { rev: document._rev }, doc: document };
  }

  private response(status: number, json: unknown): { status: number; json: unknown; text: string } {
    return { status, json, text: JSON.stringify(json) };
  }
}

describe("encrypted CouchDB round trip", () => {
  it("stores the vault salt once and lets a reinstall recover it", async () => {
    const server = new FakeCouch();
    const client = new CouchClient("https://example.org", "test", "user", "password", server.request);
    const context = await createCryptoContext("очень-длинный-пароль", "AAECAwQFBgcICQoLDA0ODw==");
    const verifier = await encryptBytes(context, utf8('{"marker":"vps-sync","schema":1}'));

    const first = await client.putVaultConfig({
      type: "config",
      schema: 1,
      encryptionSalt: "AAECAwQFBgcICQoLDA0ODw==",
      verifier,
      createdAt: 1
    });
    const restored = await client.fetchVaultConfig();

    expect(first.encryptionSalt).toBe("AAECAwQFBgcICQoLDA0ODw==");
    expect(restored?.encryptionSalt).toBe(first.encryptionSalt);
    await expect(client.hasHeadDocuments()).resolves.toBe(false);
  });

  it("stores and restores an encrypted file through the real client methods", async () => {
    const server = new FakeCouch();
    const client = new CouchClient("https://example.org", "test", "user", "password", server.request);
    const context = await createCryptoContext("очень-длинный-пароль", "AAECAwQFBgcICQoLDA0ODw==");
    const content = utf8("# Этика\n\nСодержимое заметки");
    const contentHash = await sha256(toArrayBuffer(content));
    const encrypted = await encryptBytes(context, content);
    const blobKey = await keyedId(context, "blob", contentHash);
    const chunks = await client.uploadBlob(blobKey, encrypted.data, 8);

    const payload: RemotePayload = {
      schema: 1,
      path: "философия/этика.md",
      pathKey: "философия/этика.md",
      kind: "file",
      deleted: false,
      contentHash,
      blobKey,
      chunks,
      contentIv: encrypted.iv,
      size: content.byteLength,
      mtime: 1,
      deviceId: "computer",
      deviceName: "Компьютер",
      updatedAt: 1
    };
    await client.putHead(context, payload);

    await expect(client.hasHeadDocuments()).resolves.toBe(true);

    const manifest = await client.fetchManifest(context);
    const remote = manifest.get(payload.pathKey);
    expect(remote?.path).toBe(payload.path);
    const encryptedDownload = await client.downloadBlob(blobKey, chunks);
    const decrypted = await decryptBytes(context, { iv: encrypted.iv, data: encryptedDownload });
    expect(decrypted).toEqual(content);
  });

  it("does not reuse ciphertext when unchanged content is encrypted again", async () => {
    const server = new FakeCouch();
    const client = new CouchClient("https://example.org", "test", "user", "password", server.request);
    const context = await createCryptoContext("очень-длинный-пароль", "AAECAwQFBgcICQoLDA0ODw==");
    const content = utf8("одинаковое содержимое");
    const contentHash = await sha256(toArrayBuffer(content));

    const firstEncrypted = await encryptBytes(context, content);
    const firstBlobKey = await keyedId(context, "blob", `v2:${contentHash}:${firstEncrypted.iv}`);
    const firstChunks = await client.uploadBlob(firstBlobKey, firstEncrypted.data, 8);
    const basePayload: RemotePayload = {
      schema: 1,
      path: "заметка.md",
      pathKey: "заметка.md",
      kind: "file",
      deleted: false,
      contentHash,
      blobKey: firstBlobKey,
      chunks: firstChunks,
      contentIv: firstEncrypted.iv,
      blobVersion: 2,
      size: content.byteLength,
      mtime: 1,
      deviceId: "computer",
      deviceName: "Компьютер",
      updatedAt: 1
    };
    const firstHead = await client.putHead(context, basePayload);

    const secondEncrypted = await encryptBytes(context, content);
    const secondBlobKey = await keyedId(context, "blob", `v2:${contentHash}:${secondEncrypted.iv}`);
    expect(secondBlobKey).not.toBe(firstBlobKey);
    const secondChunks = await client.uploadBlob(secondBlobKey, secondEncrypted.data, 8);
    await client.putHead(
      context,
      {
        ...basePayload,
        blobKey: secondBlobKey,
        chunks: secondChunks,
        contentIv: secondEncrypted.iv,
        updatedAt: 2
      },
      firstHead
    );

    const manifest = await client.fetchManifest(context);
    const latest = manifest.get("заметка.md");
    expect(latest?.blobKey).toBe(secondBlobKey);
    const encryptedDownload = await client.downloadBlob(secondBlobKey, secondChunks);
    const decrypted = await decryptBytes(context, { iv: secondEncrypted.iv, data: encryptedDownload });
    expect(decrypted).toEqual(content);
  });
});

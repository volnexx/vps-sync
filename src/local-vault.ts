import type { App, DataWriteOptions, FileSystemAdapter, Stat } from "obsidian";
import { sha256 } from "./crypto";
import { toArrayBuffer } from "./encoding";
import { caseCollisionPath, normaliseRelativePath, parentPaths, pathKey, PathRules } from "./path-rules";
import { FOLDER_TOKEN } from "./reconcile";
import type { LocalEntry, SyncedFileState } from "./types";

export interface ScanResult {
  entries: Map<string, LocalEntry>;
  skipped: string[];
  renamedCaseCollisions: string[];
}

function asFileSystemAdapter(app: App): FileSystemAdapter {
  return app.vault.adapter as FileSystemAdapter;
}

export class LocalVault {
  private readonly adapter: FileSystemAdapter;

  constructor(
    app: App,
    private readonly rules: PathRules,
    private readonly maxFileSizeBytes: number
  ) {
    this.adapter = asFileSystemAdapter(app);
  }

  async scan(previousFiles: Record<string, SyncedFileState>): Promise<ScanResult> {
    const entries = new Map<string, LocalEntry>();
    const skipped: string[] = [];
    const renamedCaseCollisions: string[] = [];
    const pending = [""];

    while (pending.length > 0) {
      const base = pending.shift() ?? "";
      const listing = await this.adapter.list(base);
      for (const rawFolder of listing.folders) {
        let folder = normaliseRelativePath(rawFolder);
        if (this.rules.isExcluded(folder)) continue;
        const folderCollision = entries.get(pathKey(folder));
        if (folderCollision && folderCollision.path !== folder) {
          const original = folder;
          folder = await this.renameCaseCollision(folder, entries);
          renamedCaseCollisions.push(`${original} → ${folder}`);
        }
        this.addEntry(entries, {
          path: folder,
          pathKey: pathKey(folder),
          kind: "folder",
          size: 0,
          mtime: 0,
          hash: FOLDER_TOKEN
        });
        pending.push(folder);
      }
      for (const rawFile of listing.files) {
        let file = normaliseRelativePath(rawFile);
        if (this.rules.isExcluded(file)) continue;
        const fileCollision = entries.get(pathKey(file));
        if (fileCollision && fileCollision.path !== file) {
          const original = file;
          file = await this.renameCaseCollision(file, entries);
          renamedCaseCollisions.push(`${original} → ${file}`);
        }
        const stat = await this.adapter.stat(file);
        if (!stat || stat.type !== "file") continue;
        if (stat.size > this.maxFileSizeBytes) {
          skipped.push(`${file}: ${stat.size} байт`);
          continue;
        }
        const key = pathKey(file);
        const previous = previousFiles[key];
        let hash: string;
        if (
          previous?.kind === "file" &&
          previous.localMtime === stat.mtime &&
          previous.localSize === stat.size &&
          previous.token.startsWith("file:")
        ) {
          hash = previous.token.slice("file:".length);
        } else {
          hash = await this.hashFile(file);
        }
        this.addEntry(entries, {
          path: file,
          pathKey: key,
          kind: "file",
          size: stat.size,
          mtime: stat.mtime,
          hash
        });
      }
    }
    return { entries, skipped, renamedCaseCollisions };
  }

  private async renameCaseCollision(path: string, entries: Map<string, LocalEntry>): Promise<string> {
    for (let sequence = 1; sequence < 10_000; sequence += 1) {
      const target = caseCollisionPath(path, sequence);
      if (!entries.has(pathKey(target)) && !(await this.adapter.exists(target))) {
        await this.adapter.rename(path, target);
        return target;
      }
    }
    throw new Error(`Не удалось подобрать безопасное имя для пути: ${path}`);
  }

  private addEntry(entries: Map<string, LocalEntry>, entry: LocalEntry): void {
    const existing = entries.get(entry.pathKey);
    if (existing && existing.path !== entry.path) {
      throw new Error(`Найдены пути, различающиеся только регистром: ${existing.path} и ${entry.path}`);
    }
    entries.set(entry.pathKey, entry);
  }

  async read(path: string): Promise<Uint8Array<ArrayBuffer>> {
    return new Uint8Array(await this.adapter.readBinary(path));
  }

  async hashFile(path: string): Promise<string> {
    const bytes = await this.read(path);
    return sha256(toArrayBuffer(bytes));
  }

  async ensureFolder(path: string): Promise<void> {
    for (const parent of [...parentPaths(path), normaliseRelativePath(path)]) {
      if (!(await this.adapter.exists(parent))) await this.adapter.mkdir(parent);
    }
  }

  async write(path: string, data: Uint8Array, mtime: number): Promise<Stat | null> {
    const parents = parentPaths(path);
    if (parents.length > 0) await this.ensureFolder(parents.at(-1) ?? "");
    const existing = await this.adapter.stat(path);
    if (existing?.type === "folder") {
      const listing = await this.adapter.list(path);
      if (listing.files.length > 0 || listing.folders.length > 0) {
        throw new Error(`Нельзя заменить непустую папку файлом: ${path}`);
      }
      await this.adapter.rmdir(path, false);
    }
    const options: DataWriteOptions = { mtime, ctime: mtime };
    await this.adapter.writeBinary(path, toArrayBuffer(data), options);
    return this.adapter.stat(path);
  }

  async remove(path: string): Promise<void> {
    const stat = await this.adapter.stat(path);
    if (!stat) return;
    if (stat.type === "folder") {
      const listing = await this.adapter.list(path);
      if (listing.files.length > 0 || listing.folders.length > 0) return;
      await this.adapter.rmdir(path, false);
      return;
    }
    await this.adapter.remove(path);
  }

  async moveToConflict(path: string, target: string): Promise<void> {
    const parents = parentPaths(target);
    if (parents.length > 0) await this.ensureFolder(parents.at(-1) ?? "");
    await this.adapter.rename(path, target);
  }

  async stat(path: string): Promise<Stat | null> {
    return this.adapter.stat(path);
  }
}

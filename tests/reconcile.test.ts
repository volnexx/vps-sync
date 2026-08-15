import { describe, expect, it } from "vitest";
import { decideAction } from "../src/reconcile";
import type { LocalEntry, RemoteEntry, SyncedFileState } from "../src/types";

const local = (hash: string): LocalEntry => ({
  path: "заметка.md",
  pathKey: "заметка.md",
  kind: "file",
  size: 10,
  mtime: 1,
  hash
});

const remote = (hash: string, deleted = false): RemoteEntry => ({
  schema: 1,
  id: "head:id",
  rev: "1-rev",
  path: "заметка.md",
  pathKey: "заметка.md",
  kind: "file",
  deleted,
  contentHash: deleted ? undefined : hash,
  blobKey: deleted ? undefined : "blob",
  chunks: deleted ? undefined : 1,
  contentIv: deleted ? undefined : "iv",
  size: deleted ? 0 : 10,
  mtime: 1,
  deviceId: "device",
  deviceName: "Устройство",
  updatedAt: 1
});

const previous = (token: string): SyncedFileState => ({
  path: "заметка.md",
  kind: "file",
  token,
  localMtime: 1,
  localSize: 10,
  remoteRev: "1-rev"
});

describe("reconciliation", () => {
  it("downloads a remote-only file on a new device", () => {
    expect(decideAction("заметка.md", undefined, remote("one"), undefined, "prefer-remote").type).toBe("download");
  });

  it("uploads a locally changed file", () => {
    const action = decideAction("заметка.md", local("two"), remote("one"), previous("file:one"), "merge");
    expect(action.type).toBe("upload");
  });

  it("downloads a remotely changed file", () => {
    const action = decideAction("заметка.md", local("one"), remote("two"), previous("file:one"), "merge");
    expect(action.type).toBe("download");
  });

  it("preserves both independently changed versions", () => {
    const action = decideAction("заметка.md", local("local"), remote("remote"), previous("file:base"), "merge");
    expect(action.type).toBe("conflict");
  });

  it("propagates an explicit remote tombstone", () => {
    const action = decideAction("заметка.md", local("one"), remote("one", true), previous("file:one"), "merge");
    expect(action.type).toBe("delete-local");
  });

  it("never treats a missing server head as deletion", () => {
    const action = decideAction("заметка.md", local("one"), undefined, previous("file:one"), "merge");
    expect(action.type).toBe("upload");
  });

  it("removes an extra plug-in from a new secondary device", () => {
    const pluginFile: LocalEntry = {
      path: ".obsidian/plugins/unneeded/main.js",
      pathKey: ".obsidian/plugins/unneeded/main.js",
      kind: "file",
      size: 10,
      mtime: 1,
      hash: "plugin"
    };
    const action = decideAction(pluginFile.pathKey, pluginFile, undefined, undefined, "prefer-remote");
    expect(action.type).toBe("delete-local");
  });

  it("does not remove an extra note from a new secondary device", () => {
    const action = decideAction("заметка.md", local("one"), undefined, undefined, "prefer-remote");
    expect(action.type).toBe("upload");
  });

  it("re-encrypts a legacy blob during an authoritative desktop upload", () => {
    const action = decideAction("заметка.md", local("one"), remote("one"), previous("file:one"), "prefer-local");
    expect(action.type).toBe("upload");
  });

  it("does not re-upload a matching version-two blob", () => {
    const versionTwo = { ...remote("one"), blobVersion: 2 as const };
    const action = decideAction("заметка.md", local("one"), versionTwo, undefined, "prefer-local");
    expect(action.type).toBe("equal");
  });
});

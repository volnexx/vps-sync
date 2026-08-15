import { describe, expect, it } from "vitest";
import { createCryptoContext, decryptBytes, decryptJson, encryptBytes, encryptJson, keyedId, sha256 } from "../src/crypto";
import { decodeUtf8, toArrayBuffer, utf8 } from "../src/encoding";

describe("client-side encryption", () => {
  it("encrypts and decrypts file data and metadata", async () => {
    const context = await createCryptoContext("очень-длинный-пароль", "AAECAwQFBgcICQoLDA0ODw==");
    const encrypted = await encryptBytes(context, utf8("секретная заметка"));
    expect(encrypted.data).not.toContain("секретная");
    const decrypted = await decryptBytes(context, encrypted);
    expect(decodeUtf8(toArrayBuffer(decrypted))).toBe("секретная заметка");

    const encryptedJson = await encryptJson(context, { path: "философия/этика.md" });
    await expect(decryptJson(context, encryptedJson)).resolves.toEqual({ path: "философия/этика.md" });
  });

  it("creates stable keyed identifiers without exposing the path", async () => {
    const context = await createCryptoContext("очень-длинный-пароль", "AAECAwQFBgcICQoLDA0ODw==");
    const first = await keyedId(context, "path", "философия/этика.md");
    const second = await keyedId(context, "path", "философия/этика.md");
    expect(first).toBe(second);
    expect(first).not.toContain("этика");
    await expect(sha256(toArrayBuffer(utf8("abc")))).resolves.toHaveLength(43);
  });
});

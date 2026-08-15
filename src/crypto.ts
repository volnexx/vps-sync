import { base64ToBytes, bytesToBase64, bytesToBase64Url, decodeUtf8, toArrayBuffer, utf8 } from "./encoding";
import type { EncryptedValue } from "./types";

const PBKDF2_ITERATIONS = 310_000;

export interface CryptoContext {
  aesKey: CryptoKey;
  hmacKey: CryptoKey;
}

export function createSalt(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(24)));
}

export async function createCryptoContext(passphrase: string, saltBase64: string): Promise<CryptoContext> {
  if (passphrase.length < 12) {
    throw new Error("Пароль шифрования должен содержать не менее 12 символов");
  }
  const material = await crypto.subtle.importKey("raw", toArrayBuffer(utf8(passphrase)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(base64ToBytes(saltBase64)),
      iterations: PBKDF2_ITERATIONS
    },
    material,
    512
  );
  const bytes = new Uint8Array(bits);
  const aesKey = await crypto.subtle.importKey("raw", bytes.slice(0, 32), "AES-GCM", false, ["encrypt", "decrypt"]);
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    bytes.slice(32, 64),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return { aesKey, hmacKey };
}

export async function sha256(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function keyedId(context: CryptoContext, namespace: "path" | "blob", value: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", context.hmacKey, toArrayBuffer(utf8(`${namespace}:${value}`)));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function encryptBytes(context: CryptoContext, value: Uint8Array): Promise<EncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    context.aesKey,
    toArrayBuffer(value)
  );
  return {
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted))
  };
}

export async function decryptBytes(context: CryptoContext, value: EncryptedValue): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(base64ToBytes(value.iv)) },
      context.aesKey,
      toArrayBuffer(base64ToBytes(value.data))
    );
    return new Uint8Array(decrypted);
  } catch {
    throw new Error("Не удалось расшифровать данные: пароль или соль не совпадают");
  }
}

export async function encryptJson(context: CryptoContext, value: unknown): Promise<EncryptedValue> {
  return encryptBytes(context, utf8(JSON.stringify(value)));
}

export async function decryptJson<T>(context: CryptoContext, value: EncryptedValue): Promise<T> {
  const bytes = await decryptBytes(context, value);
  return JSON.parse(decodeUtf8(toArrayBuffer(bytes))) as T;
}

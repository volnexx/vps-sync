const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8(value: string): Uint8Array {
  return encoder.encode(value);
}

export function decodeUtf8(value: BufferSource): string {
  return decoder.decode(value);
}

export function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  const block = 0x8000;
  for (let offset = 0; offset < value.length; offset += block) {
    binary += String.fromCharCode(...value.subarray(offset, Math.min(offset + block, value.length)));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

export function bytesToBase64Url(value: Uint8Array): string {
  return bytesToBase64(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function concatBytes(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.slice().buffer;
}

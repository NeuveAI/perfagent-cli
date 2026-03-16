import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { decryptAes128Cbc, decryptAes256Gcm, deriveKey } from "../src/utils/crypto.js";

describe("deriveKey", () => {
  it("produces a 16-byte key", () => {
    const key = deriveKey("test-password", 1003);
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(16);
  });

  it("produces different keys for different passwords", () => {
    const keyA = deriveKey("password-a", 1003);
    const keyB = deriveKey("password-b", 1003);
    expect(keyA.equals(keyB)).toBe(false);
  });

  it("matches manual pbkdf2Sync", () => {
    const password = "Chrome Safe Storage";
    const expected = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
    expect(deriveKey(password, 1003).equals(expected)).toBe(true);
  });

  it("produces deterministic output", () => {
    const keyA = deriveKey("same-pass", 1003);
    const keyB = deriveKey("same-pass", 1003);
    expect(keyA.equals(keyB)).toBe(true);
  });
});

describe("decryptAes128Cbc", () => {
  const encrypt = (plaintext: string, key: Buffer): Buffer => {
    const iv = Buffer.alloc(16, 0x20);
    const cipher = createCipheriv("aes-128-cbc", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([Buffer.from("v10"), encrypted]);
  };

  it("decrypts a v10-prefixed value", () => {
    const key = deriveKey("test-password", 1003);
    const encrypted = encrypt("my-cookie-value", key);
    expect(decryptAes128Cbc(encrypted, [key], false)).toBe("my-cookie-value");
  });

  it("tries multiple key candidates", () => {
    const correctKey = deriveKey("correct", 1003);
    const wrongKey = deriveKey("wrong", 1003);
    const encrypted = encrypt("secret", correctKey);
    expect(decryptAes128Cbc(encrypted, [wrongKey, correctKey], false)).toBe("secret");
  });

  it("returns undefined when no key works", () => {
    const correctKey = deriveKey("correct", 1003);
    const wrongKey = deriveKey("wrong", 1003);
    const encrypted = encrypt("secret", correctKey);
    expect(decryptAes128Cbc(encrypted, [wrongKey], false)).toBeUndefined();
  });

  it("returns undefined for short buffers", () => {
    expect(decryptAes128Cbc(new Uint8Array([1, 2]), [], false)).toBeUndefined();
  });

  it("treats non-v10 prefix as plaintext", () => {
    const plainBuffer = Buffer.from("plain-value");
    expect(decryptAes128Cbc(plainBuffer, [], false)).toBe("plain-value");
  });

  it("returns empty string for v10 prefix with no ciphertext", () => {
    expect(decryptAes128Cbc(Buffer.from("v10"), [], false)).toBe("");
  });

  it("strips hash prefix when enabled", () => {
    const key = deriveKey("test", 1003);
    const hashPrefix = randomBytes(32);
    const plaintext = Buffer.concat([hashPrefix, Buffer.from("actual-value")]);
    const iv = Buffer.alloc(16, 0x20);
    const cipher = createCipheriv("aes-128-cbc", key, iv);
    const encrypted = Buffer.concat([Buffer.from("v10"), cipher.update(plaintext), cipher.final()]);
    expect(decryptAes128Cbc(encrypted, [key], true)).toBe("actual-value");
  });
});

describe("decryptAes256Gcm", () => {
  const encrypt = (plaintext: string, key: Buffer): Buffer => {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([Buffer.from("v10"), nonce, encrypted, authTag]);
  };

  it("decrypts a v10-prefixed AES-256-GCM value", () => {
    const key = randomBytes(32);
    const encrypted = encrypt("windows-cookie", key);
    expect(decryptAes256Gcm(encrypted, key, false)).toBe("windows-cookie");
  });

  it("returns undefined for wrong key", () => {
    const correctKey = randomBytes(32);
    const wrongKey = randomBytes(32);
    const encrypted = encrypt("secret", correctKey);
    expect(decryptAes256Gcm(encrypted, wrongKey, false)).toBeUndefined();
  });

  it("returns undefined for short buffers", () => {
    expect(decryptAes256Gcm(new Uint8Array([1, 2]), randomBytes(32), false)).toBeUndefined();
  });
});

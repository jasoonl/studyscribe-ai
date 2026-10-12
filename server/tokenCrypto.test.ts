import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, getEncryptionSecret } from "./tokenCrypto";

const SECRET = "test-secret-for-encryption";

describe("token encryption", () => {
  it("round-trips a value and never stores it in the clear", () => {
    const sealed = encryptSecret("ya29.access-token", "integration-token", SECRET);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("ya29");
    expect(decryptSecret(sealed, "integration-token", SECRET)).toBe("ya29.access-token");
  });

  it("uses a fresh IV, so the same value encrypts differently each time", () => {
    expect(encryptSecret("same", "integration-token", SECRET)).not.toBe(encryptSecret("same", "integration-token", SECRET));
  });

  it("keeps purposes apart: a webhook secret cannot be read as an integration token", () => {
    const sealed = encryptSecret("whsec_x", "webhook-secret", SECRET);
    expect(() => decryptSecret(sealed, "integration-token", SECRET)).toThrow(/could not be decrypted/);
  });

  it("detects tampering and a wrong key", () => {
    const sealed = encryptSecret("value", "integration-token", SECRET);
    const parts = sealed.split(".");
    const flipped = Buffer.from(parts[3], "base64url");
    flipped[0] ^= 1;
    expect(() => decryptSecret([parts[0], parts[1], parts[2], flipped.toString("base64url")].join("."), "integration-token", SECRET)).toThrow();
    expect(() => decryptSecret(sealed, "integration-token", "another-secret")).toThrow(/different encryption key/);
    expect(() => decryptSecret("plain-text", "integration-token", SECRET)).toThrow(/unknown format/);
  });

  it("prefers INTEGRATIONS_ENCRYPTION_KEY, falls back to JWT_SECRET, and refuses to guess in production", () => {
    expect(getEncryptionSecret({ INTEGRATIONS_ENCRYPTION_KEY: "a", JWT_SECRET: "b" } as any)).toBe("a");
    expect(getEncryptionSecret({ JWT_SECRET: "b" } as any)).toBe("b");
    expect(getEncryptionSecret({ NODE_ENV: "production" } as any)).toBeNull();
    expect(getEncryptionSecret({ NODE_ENV: "development" } as any)).toBeTruthy();
  });
});

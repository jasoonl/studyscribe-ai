import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

/**
 * Encryption at rest for third-party credentials: Notion and Google OAuth
 * tokens, and the signing secrets of outgoing webhooks. AES-256-GCM with a key
 * derived (HKDF-SHA256) from INTEGRATIONS_ENCRYPTION_KEY, or from JWT_SECRET
 * when that is not set. Each purpose gets its own derived key, so a value
 * encrypted for one use cannot be decrypted as another.
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 * Rotating the env secret makes stored values unreadable; the owner then has
 * to reconnect integrations and rotate webhook secrets.
 */

const VERSION = "v1";
const DEV_FALLBACK_SECRET = "studyscribe-dev-only-integrations-secret";

export type CryptoPurpose = "integration-token" | "webhook-secret";

export function getEncryptionSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.INTEGRATIONS_ENCRYPTION_KEY?.trim();
  if (explicit) return explicit;
  const jwt = env.JWT_SECRET?.trim();
  if (jwt) return jwt;
  return env.NODE_ENV === "production" ? null : DEV_FALLBACK_SECRET;
}

export function isEncryptionConfigured(env: NodeJS.ProcessEnv = process.env) {
  return getEncryptionSecret(env) !== null;
}

function deriveKey(secret: string, purpose: CryptoPurpose): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.from("studyscribe-integrations", "utf8"), Buffer.from(purpose, "utf8"), 32));
}

function requireSecret(secret?: string) {
  const value = secret ?? getEncryptionSecret();
  if (!value) throw new Error("Set INTEGRATIONS_ENCRYPTION_KEY (or JWT_SECRET) to store connected accounts and webhook secrets.");
  return value;
}

export function encryptSecret(plain: string, purpose: CryptoPurpose, secret?: string): string {
  const key = deriveKey(requireSecret(secret), purpose);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(sealed: string, purpose: CryptoPurpose, secret?: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("Stored credential is in an unknown format.");
  const [, iv, tag, ciphertext] = parts;
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(requireSecret(secret), purpose), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Stored credential could not be decrypted. It may have been saved with a different encryption key.");
  }
}

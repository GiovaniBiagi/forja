import { randomBytes, createHash } from "node:crypto";

/**
 * Generates a cryptographically random opaque token as a hex string.
 * @param bytes - Number of random bytes (default 32, producing a 64-char hex string).
 * @returns Random hex string.
 */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * Hashes a token using SHA-256. Used to store opaque tokens securely.
 * @param token - The raw token string to hash.
 * @returns Hex-encoded SHA-256 hash.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

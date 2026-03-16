import * as argon2 from "argon2";

/**
 * Hashes a plaintext password using argon2.
 * @param password - The plaintext password to hash.
 * @returns The hashed password string.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

/**
 * Verifies a plaintext password against an argon2 hash.
 * @param hash - The stored password hash.
 * @param password - The plaintext password to verify.
 * @returns `true` if the password matches, `false` otherwise.
 */
export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  return argon2.verify(hash, password);
}

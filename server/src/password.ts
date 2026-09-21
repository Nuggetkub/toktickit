import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Password hashing and the password policy (BR-10, BR-11).
//
// scrypt from Node's standard library rather than bcrypt or Argon2: both of
// those are native modules that have to compile on every contributor's machine,
// including Windows, and scrypt is memory-hard, in the standard library, and
// needs no build step (decision D-04). The parameters are an OWASP-listed set.

const N = 32_768; // 2^15
const R = 8;
const P = 3;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
// 128 KiB * N * r would be the minimum; Node's default maxmem is 32 MiB, which
// this configuration exceeds, so it has to be raised explicitly or scrypt throws.
const MAXMEM = 128 * 1024 * 1024;

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/**
 * A self-describing hash: `scrypt$N$r$p$salt$key`, both values base64url.
 *
 * Storing the parameters with the hash means the cost can be raised later
 * without invalidating existing passwords — verification reads the parameters
 * from the stored string rather than assuming today's constants.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** Constant-time verification. Any malformed stored value is a failure, never a throw. */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) return false;

  try {
    const salt = Buffer.from(parts[4], "base64url");
    const expected = Buffer.from(parts[5], "base64url");
    if (salt.length === 0 || expected.length === 0) return false;

    const actual = await deriveKey(password, salt, n, r, p, expected.length);
    // Lengths are compared first because timingSafeEqual throws on a mismatch.
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * The hash a sign-in verifies against when the email is unknown or the account
 * has no password yet, so that both paths cost the same scrypt derivation and
 * response time does not reveal which accounts exist (BR-06).
 *
 * Built once per process and never compared successfully: nothing can produce
 * this password, and the caller discards the result either way.
 */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(`unusable ${randomBytes(24).toString("base64url")}`);
  return dummyHash;
}

export type PasswordCheck = { ok: true; fieldErrors?: never } | { ok?: never; fieldErrors: Record<string, string> };

/**
 * BR-11, in one place so the API and the Change Password screen cannot drift:
 * 12 to 128 characters, not only whitespace, never trimmed, different from the
 * current password and from the account's email, and matching its confirmation.
 *
 * No composition rule. Current NIST guidance (SP 800-63B) finds that character
 * classes produce predictable passwords and recommends length instead (D-05).
 */
export function validateNewPassword(input: {
  newPassword: unknown;
  confirmPassword?: unknown;
  currentPassword?: string;
  email?: string;
}): PasswordCheck {
  const fieldErrors: Record<string, string> = {};
  const { newPassword } = input;

  if (typeof newPassword !== "string" || newPassword.length === 0) {
    fieldErrors.newPassword = "Enter a new password.";
    return { fieldErrors };
  }

  // Counted in code points, so a password of emoji or Thai characters is
  // measured the way a person would count it rather than in UTF-16 units.
  const length = [...newPassword].length;
  if (length < PASSWORD_MIN || length > PASSWORD_MAX) {
    fieldErrors.newPassword = `Use ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`;
  } else if (newPassword.trim().length === 0) {
    fieldErrors.newPassword = "A password cannot be only spaces.";
  } else if (input.currentPassword !== undefined && newPassword === input.currentPassword) {
    fieldErrors.newPassword = "Choose a password different from your current one.";
  } else if (input.email !== undefined && newPassword.toLowerCase() === input.email.trim().toLowerCase()) {
    fieldErrors.newPassword = "Choose a password different from your email address.";
  }

  if (input.confirmPassword !== undefined && newPassword !== input.confirmPassword) {
    fieldErrors.confirmPassword = "The confirmation does not match the new password.";
  }

  return Object.keys(fieldErrors).length > 0 ? { fieldErrors } : { ok: true };
}

/**
 * Trimmed, lowercased and format-checked (BR-08). Returns undefined when the
 * value is not a usable address, so callers report one field error rather than
 * each inventing their own rule.
 */
export function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 254) return undefined;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized) ? normalized : undefined;
}

function deriveKey(password: string, salt: Buffer, n: number, r: number, p: number, keyLength = KEY_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { N: n, r, p, maxmem: MAXMEM }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

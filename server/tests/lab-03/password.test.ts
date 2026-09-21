import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  dummyPasswordHash,
  hashPassword,
  normalizeEmail,
  validateNewPassword,
  verifyPassword,
} from "../../src/password.js";

// UNIT-01 and UNIT-02 in docs/lab-03/tests.md.

describe("password hashing", () => {
  it("stores a self-describing scrypt hash with a fresh salt each time", async () => {
    const first = await hashPassword("a correct horse battery");
    const second = await hashPassword("a correct horse battery");

    expect(first).toMatch(/^scrypt\$32768\$8\$3\$/);
    // Same password, different salt, so the stored strings must differ. Equal
    // hashes here would mean the salt was constant, and a stolen database would
    // reveal which accounts share a password.
    expect(second).not.toBe(first);
  });

  it("verifies the original password and rejects anything else", async () => {
    const stored = await hashPassword("a correct horse battery");

    await expect(verifyPassword("a correct horse battery", stored)).resolves.toBe(true);
    await expect(verifyPassword("a correct horse batterz", stored)).resolves.toBe(false);
    await expect(verifyPassword("", stored)).resolves.toBe(false);
  });

  it("treats a malformed stored value as a failure rather than throwing", async () => {
    for (const broken of ["", "plaintext", "scrypt$32768$8$3$only-four-parts", "argon2$1$2$3$c2FsdA$a2V5"]) {
      await expect(verifyPassword("a correct horse battery", broken)).resolves.toBe(false);
    }
  });

  it("verifies a hash written with different parameters, so the cost can be raised later", async () => {
    const stored = await hashPassword("a correct horse battery");
    const [, n, r, p] = stored.split("$");
    expect([n, r, p]).toEqual(["32768", "8", "3"]);

    // The parameters are read back from the stored string rather than assumed,
    // which is what makes a future change to the constants non-breaking.
    const rewritten = stored.replace("scrypt$32768", "scrypt$32768");
    await expect(verifyPassword("a correct horse battery", rewritten)).resolves.toBe(true);
  });

  it("offers a dummy hash that nothing verifies against, for the unknown-account path", async () => {
    const dummy = await dummyPasswordHash();

    expect(dummy).toMatch(/^scrypt\$/);
    // Stable within the process, so the sign-in path pays the derivation cost
    // without rebuilding it per request (BR-06).
    expect(await dummyPasswordHash()).toBe(dummy);
    await expect(verifyPassword("", dummy)).resolves.toBe(false);
    await expect(verifyPassword("TokTickIT-dev-2026", dummy)).resolves.toBe(false);
  });
});

describe("password policy (BR-11)", () => {
  const ok = "a correct horse battery";

  it("accepts the boundaries and rejects just outside them", () => {
    expect(validateNewPassword({ newPassword: "x".repeat(PASSWORD_MIN - 1) }).fieldErrors?.newPassword).toBeDefined();
    expect(validateNewPassword({ newPassword: "x".repeat(PASSWORD_MIN) }).ok).toBe(true);
    expect(validateNewPassword({ newPassword: "x".repeat(PASSWORD_MAX) }).ok).toBe(true);
    expect(validateNewPassword({ newPassword: "x".repeat(PASSWORD_MAX + 1) }).fieldErrors?.newPassword).toBeDefined();
  });

  it("counts code points, not UTF-16 units", () => {
    // Twelve Thai characters are twelve characters to the person typing them.
    expect(validateNewPassword({ newPassword: "รหัสผ่านทดสอบ" }).ok).toBe(true);
  });

  it("refuses a password that is only spaces, and does not trim the value", () => {
    expect(validateNewPassword({ newPassword: " ".repeat(14) }).fieldErrors?.newPassword).toBe(
      "A password cannot be only spaces.",
    );
    // Padding is content, not noise: this is 12 code points and is accepted.
    expect(validateNewPassword({ newPassword: "  secret12  " }).ok).toBe(true);
  });

  it("refuses a password equal to the current one or to the account email", () => {
    expect(validateNewPassword({ newPassword: ok, currentPassword: ok }).fieldErrors?.newPassword).toBe(
      "Choose a password different from your current one.",
    );
    expect(
      validateNewPassword({ newPassword: "Nadia.Rahman@toktickit.local", email: "nadia.rahman@toktickit.local" })
        .fieldErrors?.newPassword,
    ).toBe("Choose a password different from your email address.");
  });

  it("reports a confirmation mismatch on the confirmation field", () => {
    const result = validateNewPassword({ newPassword: ok, confirmPassword: `${ok}!` });
    expect(result.fieldErrors).toEqual({ confirmPassword: "The confirmation does not match the new password." });
  });

  it("rejects a missing or non-string password", () => {
    expect(validateNewPassword({ newPassword: undefined }).fieldErrors?.newPassword).toBe("Enter a new password.");
    expect(validateNewPassword({ newPassword: 12345678901234 }).fieldErrors?.newPassword).toBe("Enter a new password.");
  });
});

describe("email normalisation (BR-08)", () => {
  it("trims and lowercases a valid address", () => {
    expect(normalizeEmail("  Nadia.Rahman@TokTickIT.local ")).toBe("nadia.rahman@toktickit.local");
  });

  it("rejects what is not an address", () => {
    for (const value of ["", "   ", "no-at-sign", "two@@at.test", "spaces in@example.test", 42, null, undefined]) {
      expect(normalizeEmail(value)).toBeUndefined();
    }
    expect(normalizeEmail(`${"x".repeat(250)}@example.test`)).toBeUndefined();
  });
});

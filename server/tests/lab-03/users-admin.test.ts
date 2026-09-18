import { describe, expect, it } from "vitest";
import {
  NAME_MAX,
  NAME_MIN,
  USER_SEARCH_MAX,
  losesOperatorAccess,
  removesLastActiveAdministrator,
  revokesSessions,
  selfProtectionRefusal,
  validateInitialPasswordReset,
  validateUserCreate,
  validateUserEdit,
  validateUserListQuery,
} from "../../src/users-admin.js";

// UNIT — the Administrator user-management rules (BR-38 to BR-42).
//
// These are the decisions, separated from the transaction that applies them.
// The row lock and the count it protects are the route's job and are asserted
// against a real database in users-admin.api.test.ts; what belongs here is the
// rule itself, where every branch is cheap to reach.

describe("BR-38 — the list query", () => {
  it("accepts a search, a role, and both together", () => {
    expect(validateUserListQuery({ search: "  nadia  " })).toEqual({ value: { search: "nadia" } });
    expect(validateUserListQuery({ role: "IT_STAFF" })).toEqual({ value: { role: "IT_STAFF" } });
    expect(validateUserListQuery({ search: "a", role: "ADMINISTRATOR" })).toEqual({
      value: { search: "a", role: "ADMINISTRATOR" },
    });
    expect(validateUserListQuery({})).toEqual({ value: {} });
  });

  it("rejects rather than ignores an unusable filter", () => {
    // Lab 2 BR-27. This is the defect I found in my peer's queue validator on
    // his PR #46: a filter that is accepted and silently dropped returns an
    // unfiltered list the caller believes is filtered.
    expect(validateUserListQuery({ role: "SUPERUSER" }).fieldErrors).toHaveProperty("role");
    expect(validateUserListQuery({ search: "   " }).fieldErrors).toHaveProperty("search");
    expect(validateUserListQuery({ search: "x".repeat(USER_SEARCH_MAX + 1) }).fieldErrors).toHaveProperty("search");
    expect(validateUserListQuery({ page: "2" }).fieldErrors).toHaveProperty("page");
  });

  it("checks every parameter even when an earlier one already failed", () => {
    // The ordering bug this guards against hides the second error entirely, so
    // the caller fixes one thing, resubmits, and is refused again for another.
    const errors = validateUserListQuery({ search: "", role: "NOPE" }).fieldErrors!;
    expect(Object.keys(errors).sort()).toEqual(["role", "search"]);
  });
});

describe("BR-39 — creating a user", () => {
  const valid = {
    fullName: "New Hire",
    email: "New.Hire@Example.Test",
    role: "IT_STAFF",
    isActive: true,
    initialPassword: "correct-horse-battery-staple",
  };

  it("normalises the email and trims the name", () => {
    const result = validateUserCreate({ ...valid, fullName: "  New Hire  " });
    expect(result.value).toMatchObject({ fullName: "New Hire", email: "new.hire@example.test" });
  });

  it("names each invalid field on its own", () => {
    const errors = validateUserCreate({
      fullName: "A",
      email: "not-an-address",
      role: "SUPERUSER",
      isActive: "yes",
      initialPassword: "short",
    }).fieldErrors!;

    expect(Object.keys(errors).sort()).toEqual(["email", "fullName", "initialPassword", "isActive", "role"]);
  });

  it("holds the name to BR-39's boundaries", () => {
    expect(validateUserCreate({ ...valid, fullName: "x".repeat(NAME_MIN - 1) }).fieldErrors).toHaveProperty("fullName");
    expect(validateUserCreate({ ...valid, fullName: "x".repeat(NAME_MIN) }).value).toBeDefined();
    expect(validateUserCreate({ ...valid, fullName: "x".repeat(NAME_MAX) }).value).toBeDefined();
    expect(validateUserCreate({ ...valid, fullName: "x".repeat(NAME_MAX + 1) }).fieldErrors).toHaveProperty("fullName");
  });

  it("reports a password rule under the field this endpoint actually has", () => {
    // validateNewPassword keys its errors as `newPassword`, which is not a field
    // of this request. A message beneath a field that is not on the form is a
    // message nobody sees.
    const errors = validateUserCreate({ ...valid, initialPassword: "tiny" }).fieldErrors!;
    expect(errors).toHaveProperty("initialPassword");
    expect(errors).not.toHaveProperty("newPassword");
  });

  it("refuses a password equal to the account's own email (BR-11)", () => {
    const errors = validateUserCreate({ ...valid, initialPassword: "new.hire@example.test" }).fieldErrors!;
    expect(errors).toHaveProperty("initialPassword");
  });
});

describe("BR-40 — editing", () => {
  it("accepts any single field, and rejects an empty edit", () => {
    expect(validateUserEdit({ fullName: "Renamed" }).value).toEqual({ fullName: "Renamed" });
    expect(validateUserEdit({ isActive: false }).value).toEqual({ isActive: false });
    // An empty body does not say what to change, and answering 200 would claim
    // a change that never happened.
    expect(validateUserEdit({}).fieldErrors).toBeDefined();
  });

  it("rejects an unknown field rather than ignoring it", () => {
    expect(validateUserEdit({ fullName: "Fine", passwordHash: "hunter2" }).fieldErrors).toHaveProperty("passwordHash");
    // The point of rejecting: an Administrator who thinks they set something
    // must not be told it worked.
    expect(validateUserEdit({ mustChangePassword: true }).fieldErrors).toHaveProperty("mustChangePassword");
  });

  it("normalises an edited email the same way creation does", () => {
    expect(validateUserEdit({ email: "  MIXED.Case@Example.Test " }).value).toEqual({
      email: "mixed.case@example.test",
    });
  });

  it("validates the initial-password reset against the target's own email", () => {
    expect(validateInitialPasswordReset({ initialPassword: "correct-horse-battery-staple" }, "a@b.test").value)
      .toBeDefined();
    expect(validateInitialPasswordReset({ initialPassword: "a@b.test" }, "a@b.test").fieldErrors).toHaveProperty(
      "initialPassword",
    );
  });
});

describe("BR-41 — an Administrator cannot remove their own access", () => {
  const self = { actorId: 9, targetId: 9, targetRole: "ADMINISTRATOR" as const };

  it("refuses self-deactivation and an own-role change", () => {
    expect(selfProtectionRefusal({ ...self, edit: { isActive: false } })?.code).toBe("CANNOT_DEACTIVATE_SELF");
    expect(selfProtectionRefusal({ ...self, edit: { role: "IT_STAFF" } })?.code).toBe("CANNOT_CHANGE_OWN_ROLE");
  });

  it("allows a self-rename, a self-reactivation and a no-op role", () => {
    expect(selfProtectionRefusal({ ...self, edit: { fullName: "Same Person" } })).toBeNull();
    expect(selfProtectionRefusal({ ...self, edit: { isActive: true } })).toBeNull();
    // Sending the role you already have changes nothing, so there is nothing to
    // refuse — and refusing it would fail an edit form that submits every field.
    expect(selfProtectionRefusal({ ...self, edit: { role: "ADMINISTRATOR" } })).toBeNull();
  });

  it("does not apply to somebody else", () => {
    expect(
      selfProtectionRefusal({ actorId: 9, targetId: 10, targetRole: "ADMINISTRATOR", edit: { isActive: false } }),
    ).toBeNull();
  });
});

describe("BR-42 — at least one active Administrator always remains", () => {
  const admin = { targetRole: "ADMINISTRATOR" as const, targetIsActive: true };

  it("refuses the last one's deactivation or demotion", () => {
    expect(removesLastActiveAdministrator({ ...admin, edit: { isActive: false }, activeAdministratorCount: 1 })).toBe(
      true,
    );
    expect(removesLastActiveAdministrator({ ...admin, edit: { role: "IT_STAFF" }, activeAdministratorCount: 1 })).toBe(
      true,
    );
  });

  it("allows it while another remains", () => {
    expect(removesLastActiveAdministrator({ ...admin, edit: { isActive: false }, activeAdministratorCount: 2 })).toBe(
      false,
    );
  });

  it("ignores changes that do not remove an Administrator", () => {
    expect(
      removesLastActiveAdministrator({ ...admin, edit: { fullName: "Renamed" }, activeAdministratorCount: 1 }),
    ).toBe(false);
    // Already inactive: deactivating them again removes nobody.
    expect(
      removesLastActiveAdministrator({
        targetRole: "ADMINISTRATOR",
        targetIsActive: false,
        edit: { isActive: false },
        activeAdministratorCount: 1,
      }),
    ).toBe(false);
    // Not an Administrator at all.
    expect(
      removesLastActiveAdministrator({
        targetRole: "IT_STAFF",
        targetIsActive: true,
        edit: { isActive: false },
        activeAdministratorCount: 1,
      }),
    ).toBe(false);
  });
});

describe("BR-25 and BR-15 — what a change costs elsewhere", () => {
  it("unassigns only when an operator loses their access", () => {
    expect(losesOperatorAccess({ targetRole: "IT_STAFF", edit: { isActive: false } })).toBe(true);
    expect(losesOperatorAccess({ targetRole: "ADMINISTRATOR", edit: { role: "REQUESTER" } })).toBe(true);
    expect(losesOperatorAccess({ targetRole: "IT_STAFF", edit: { fullName: "Renamed" } })).toBe(false);
    // Promotion is not a loss.
    expect(losesOperatorAccess({ targetRole: "IT_STAFF", edit: { role: "ADMINISTRATOR" } })).toBe(false);
    // A Requester never owned a ticket, so there is nothing to unassign.
    expect(losesOperatorAccess({ targetRole: "REQUESTER", edit: { isActive: false } })).toBe(false);
  });

  it("ends sessions for a role change or an activation change, and not for a rename", () => {
    const target = { targetRole: "IT_STAFF" as const, targetIsActive: true };
    expect(revokesSessions({ ...target, edit: { role: "REQUESTER" } })).toBe(true);
    expect(revokesSessions({ ...target, edit: { isActive: false } })).toBe(true);
    expect(revokesSessions({ ...target, edit: { fullName: "Renamed" } })).toBe(false);
    // Sending the values the account already has is not a change.
    expect(revokesSessions({ ...target, edit: { role: "IT_STAFF", isActive: true } })).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { formatTicketNumber } from "../../src/ticket-create.js";

// UNIT-01 — BR-02. The format is part of the contract: it appears on the success
// screen, in search, and in every screenshot the report carries, so it is worth
// pinning rather than trusting.

describe("ticket number format", () => {
  it("is TKT-<year>-<sequence> zero padded to five digits", () => {
    expect(formatTicketNumber(2026, 1)).toBe("TKT-2026-00001");
    expect(formatTicketNumber(2026, 42)).toBe("TKT-2026-00042");
    expect(formatTicketNumber(2026, 99999)).toBe("TKT-2026-99999");
  });

  it("restarts the sequence in a new year rather than continuing", () => {
    // The whole reason the number comes from a per-year counter and not from the
    // Ticket's own autoincrement id: an id would keep climbing across the year
    // boundary and only look per-year.
    expect(formatTicketNumber(2026, 812)).toBe("TKT-2026-00812");
    expect(formatTicketNumber(2027, 1)).toBe("TKT-2027-00001");
  });

  it("does not truncate a sequence that outgrows the padding", () => {
    // Better a six-digit number than a wrong five-digit one.
    expect(formatTicketNumber(2026, 100000)).toBe("TKT-2026-100000");
  });
});

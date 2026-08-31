import { describe, it, expect } from "vitest";
import {
  MAX_BYTES,
  checkAttachment,
  detectAttachmentType,
  safeDownloadName,
  validateRemovalReason,
} from "../../src/attachment-rules.js";

// UNIT-03, UNIT-04, UNIT-05 — AC-14, AC-15.

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PDF = Buffer.from("%PDF-1.7\nbody");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)]);
const EXECUTABLE = Buffer.concat([Buffer.from("MZ\x90\x00", "binary"), Buffer.alloc(32)]);

describe("attachment type detection", () => {
  it.each([
    ["PNG", PNG, "image/png"],
    ["JPEG", JPEG, "image/jpeg"],
    ["PDF", PDF, "application/pdf"],
    ["WEBP", WEBP, "image/webp"],
  ])("recognises %s from its leading bytes", (_label, bytes, expected) => {
    expect(detectAttachmentType(bytes as Buffer)).toBe(expected);
  });

  it("refuses a file whose content is not a permitted type, whatever it is called", () => {
    // The filename and the declared Content-Type never reach this function, by
    // design: both are supplied by the uploader.
    expect(detectAttachmentType(EXECUTABLE)).toBeNull();
    expect(checkAttachment(EXECUTABLE).rejection?.status).toBe(415);
  });

  it("refuses a file that is merely truncated to look right", () => {
    expect(detectAttachmentType(Buffer.from([0x89, 0x50]))).toBeNull();
  });
});

describe("attachment size", () => {
  it("accepts exactly the limit and refuses one byte more", () => {
    expect(checkAttachment(Buffer.concat([PNG, Buffer.alloc(MAX_BYTES - PNG.length)])).type).toBe("image/png");
    expect(checkAttachment(Buffer.alloc(MAX_BYTES + 1)).rejection?.status).toBe(413);
  });

  it("reports size before type when a file fails both", () => {
    // Size is the one the user can act on; being told the type is wrong about a
    // file that is also far too large is the less useful half of the truth.
    const huge = Buffer.concat([EXECUTABLE, Buffer.alloc(MAX_BYTES + 1)]);
    expect(checkAttachment(huge).rejection?.status).toBe(413);
  });
});

describe("removal reason", () => {
  it.each([
    ["four characters", "abcd", false],
    ["five characters", "abcde", true],
    ["250 characters", "x".repeat(250), true],
    ["251 characters", "x".repeat(251), false],
    ["whitespace only", "        ", false],
  ])("%s is accepted=%s", (_label, value, accepted) => {
    const result = validateRemovalReason({ removalReason: value });
    expect(result.reason !== undefined).toBe(accepted);
  });

  it("trims before measuring, so padding cannot satisfy the minimum", () => {
    expect(validateRemovalReason({ removalReason: "   wrong file   " }).reason).toBe("wrong file");
  });

  it.each([null, "a string", 42, [], {}])("rejects %s as a body", (body) => {
    expect(validateRemovalReason(body).fieldErrors).toBeDefined();
  });
});

// Built from a char code rather than an escape: a backslash in a source literal
// is one editing mistake away from vanishing, and a test for path stripping that
// contains no path separator passes without testing anything.
const BACKSLASH = String.fromCharCode(92);

describe("download filename", () => {
  it("keeps the name and extension but drops any path", () => {
    expect(safeDownloadName("evidence.png")).toBe("evidence.png");
    expect(safeDownloadName(["C:", "Users", "someone", "evidence.png"].join(BACKSLASH))).toBe("evidence.png");
    expect(safeDownloadName("../../etc/passwd")).toBe("passwd");
  });

  it("strips characters that would break or inject into the header", () => {
    const injected = safeDownloadName('shot".png\r\nX-Injected: yes');
    expect(injected).not.toMatch(/[\r\n"]/);
  });

  it("never returns an empty name", () => {
    expect(safeDownloadName("...")).toBe("attachment");
    expect(safeDownloadName("")).toBe("attachment");
  });
});

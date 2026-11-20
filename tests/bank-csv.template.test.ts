import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TEMPLATE } from "@/lib/bank-csv";

/**
 * The fingerprint locks the template. If this test fails, someone changed the
 * bank file layout. Do not update the hash unless the bank sent a new format.
 */
const EXPECTED_FINGERPRINT = "b613a76c7c2d3e86d40c8980ce931ac0224d0ac3f66d2b4103b5ab40e87d65b1";

describe("locked bank CSV template", () => {
  it("has the fingerprint of the approved layout", () => {
    const hash = createHash("sha256").update(JSON.stringify(TEMPLATE)).digest("hex");
    expect(hash).toBe(EXPECTED_FINGERPRINT);
  });

  it("is frozen at run time", () => {
    expect(Object.isFrozen(TEMPLATE)).toBe(true);
    expect(Object.isFrozen(TEMPLATE.payment)).toBe(true);
    expect(Object.isFrozen(TEMPLATE.headerRow)).toBe(true);
  });
});

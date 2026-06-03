/**
 * gate-lib.test.ts — the fidelity gate's over-promise vs open-assumption logic.
 *
 * The gate is the determinism, so its classification must be pinned: only true
 * over-promises block; open assumptions (expected pre-discovery, surfaced in the
 * assumption panel) pass through; anything unclassified is treated as an
 * over-promise (fail-closed).
 */
import { describe, it, expect } from "vitest";
import { evaluateFidelityGate } from "./gate-lib.js";

describe("evaluateFidelityGate", () => {
  it("passes when there are no violations", () => {
    const r = evaluateFidelityGate({ passes: true, violations: [] });
    expect(r.passed).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.requiresHuman).toBe(true);
  });

  it("passes when every violation is an open_assumption", () => {
    const r = evaluateFidelityGate({
      passes: true,
      violations: [
        { element: "KYC badge", reason: "field API name pending", severity: "low", kind: "open_assumption" },
        { element: "Activity source", reason: "Task/Event assumed", severity: "low", kind: "open_assumption" },
      ],
    });
    expect(r.passed).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it("blocks on an over_promise and lists only over-promises", () => {
    const r = evaluateFidelityGate({
      passes: false,
      violations: [
        { element: "Deviation Register", reason: "no native FSC object", severity: "high", kind: "over_promise" },
        { element: "KYC badge", reason: "field pending", severity: "low", kind: "open_assumption" },
      ],
    });
    expect(r.passed).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]).toContain("Deviation Register");
  });

  it("is fail-closed: an unclassified violation blocks", () => {
    const r = evaluateFidelityGate({
      passes: true,
      violations: [{ element: "Mystery widget", reason: "unknown", severity: "medium" }],
    });
    expect(r.passed).toBe(false);
    expect(r.failures).toHaveLength(1);
  });

  it("tolerates a missing violations array", () => {
    const r = evaluateFidelityGate({ passes: true });
    expect(r.passed).toBe(true);
  });
});

/**
 * runner.test.ts — FeedbackDiscovery (the v1→v2 loop's discovery seam): captured
 * corrections are applied; everything else confirms so the discovery loop converges.
 */
import { describe, it, expect } from "vitest";
import { FeedbackDiscovery } from "./runner.js";
import type { AssumptionAgenda } from "./discovery.js";

const agenda = {
  sowRef: "X",
  blockingCount: 0,
  items: [{ assumptionId: "ASM-01" }, { assumptionId: "ASM-02" }, { assumptionId: "ASM-03" }],
} as unknown as AssumptionAgenda;

describe("FeedbackDiscovery", () => {
  it("applies captured corrections and confirms the rest", async () => {
    const d = new FeedbackDiscovery([
      { assumptionId: "ASM-01", verdict: "correct", correction: "Use Households, not Person Accounts" },
      { assumptionId: "ASM-02", verdict: "confirm" },
    ]);
    const v = await d.collectVerdicts(agenda);
    expect(v).toEqual([
      { assumptionId: "ASM-01", verdict: "correct", correction: "Use Households, not Person Accounts" },
      { assumptionId: "ASM-02", verdict: "confirm" },
      { assumptionId: "ASM-03", verdict: "confirm" }, // not in feedback → confirm so the loop converges
    ]);
  });

  it("falls back to confirm when a correction has no text", async () => {
    const d = new FeedbackDiscovery([{ assumptionId: "ASM-01", verdict: "correct" }]);
    const v = await d.collectVerdicts(agenda);
    expect(v[0]).toEqual({ assumptionId: "ASM-01", verdict: "confirm" });
  });

  it("confirms everything when given no feedback", async () => {
    const d = new FeedbackDiscovery([]);
    const v = await d.collectVerdicts(agenda);
    expect(v.every((x) => x.verdict === "confirm")).toBe(true);
  });
});

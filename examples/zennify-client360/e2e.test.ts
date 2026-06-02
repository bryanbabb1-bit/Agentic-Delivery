/**
 * e2e.test.ts — the whole Phase-1 pipeline, end to end, deterministically.
 *
 * Proves: every stage's output satisfies its contract, the discovery loop
 * terminates once the blocking assumption is confirmed, every gate passes, and
 * the result is a reconciled, UAT-ready package with honest boundaries.
 */
import { describe, it, expect } from "vitest";
import { run, GateBlocked } from "../../driver/orchestrator.js";
import {
  FixtureRunner,
  AutoConfirmDiscovery,
  AutoApproveHumanGate,
  PausingDiscovery,
} from "../../driver/runner.js";
import { fixtures } from "./fixtures.js";

const SOW = "Client 360 in FSC — unified Person Account profile.";

function deterministicDeps() {
  return {
    runner: new FixtureRunner(fixtures),
    discovery: new AutoConfirmDiscovery(),
    humanGate: new AutoApproveHumanGate(),
  };
}

describe("Zennify Client-360 pipeline (end to end)", () => {
  it("drives a SOW to a reconciled, UAT-ready handoff", async () => {
    const result = await run({ sowRef: "ZEN-SBH-CLIENT360", sowText: SOW }, deterministicDeps());

    // Reconciled package, fidelity-stamped mockups.
    expect(result.deliverable.status).toBe("reconciled");
    expect(result.deliverable.epics.length).toBe(1);
    expect(result.deliverable.storyPackages.length).toBe(1);
    expect(result.deliverable.mockups.every((m) => m.fidelityPassed)).toBe(true);

    // Reconcile produced an audit trail.
    expect(result.reconciled.changes.length).toBeGreaterThan(0);
    expect(result.reconciled.status).toBe("reconciled");

    // Handoff is UAT-ready with mandatory honest boundaries.
    expect(result.handoff.knownBoundaries.length).toBeGreaterThan(0);
    expect(result.handoff.epicId).toBe("EP-01");
  });

  it("traces every story package back to its epic and story", async () => {
    const result = await run({ sowRef: "ZEN-SBH-CLIENT360", sowText: SOW }, deterministicDeps());
    const pkg = result.deliverable.storyPackages[0]!;
    expect(pkg.story.epicId).toBe(result.deliverable.epics[0]!.id);
    expect(pkg.solutionDesign?.storyId).toBe(pkg.story.id);
  });

  it("pauses (does not silently proceed) when discovery is not provided", async () => {
    // Default discovery throws — a blocking assumption must not be auto-resolved.
    await expect(
      run(
        { sowRef: "ZEN-SBH-CLIENT360", sowText: SOW },
        { runner: new FixtureRunner(fixtures), discovery: new PausingDiscovery(), humanGate: new AutoApproveHumanGate() },
      ),
    ).rejects.toThrow(/Discovery loop reached/);
  });

  it("blocks at the deploy-test gate when QA reports a failure", async () => {
    const failingFixtures = {
      ...fixtures,
      qa: () => ({
        buildRef: "DN-01",
        apexCoveragePct: 40, // below the 75% threshold
        flowTestsPassed: false,
        sitChecks: [],
        contractVerified: false,
        defects: ["profile did not render"],
        uatReady: false,
      }),
    };
    await expect(
      run(
        { sowRef: "ZEN-SBH-CLIENT360", sowText: SOW },
        { runner: new FixtureRunner(failingFixtures), discovery: new AutoConfirmDiscovery(), humanGate: new AutoApproveHumanGate() },
      ),
    ).rejects.toBeInstanceOf(GateBlocked);
  });
});

#!/usr/bin/env -S npx tsx
/**
 * run.ts — drive the Zennify Client-360 example end to end.
 *
 * Uses the FixtureRunner + auto discovery/approval so the whole Phase-1 pipeline
 * executes deterministically (no model, no org) and prints the reconciled
 * DeliverablePackage. This is the runnable proof that the seams, gates, and
 * discovery loop are wired correctly.
 *
 *   npm run example
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { run } from "../../driver/orchestrator.js";
import {
  FixtureRunner,
  AutoConfirmDiscovery,
  AutoApproveHumanGate,
  ConsoleProgress,
} from "../../driver/runner.js";
import { makeFixtures } from "./fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const sowRef = "ZEN-SBH-CLIENT360";

async function main(): Promise<void> {
  const sowText = await readFile(join(here, "sow.txt"), "utf8");

  // The driver renders the SLDS HTML into prototypes/ (prototypeOut).
  const result = await run(
    { sowRef, sowText, prototypeOut: { dir: join(repoRoot, "prototypes") } },
    {
      runner: new FixtureRunner(makeFixtures()),
      discovery: new AutoConfirmDiscovery(),
      humanGate: new AutoApproveHumanGate(),
      progress: new ConsoleProgress(),
    },
  );

  console.log("=== Pipeline complete ===\n");
  console.log(`Package status : ${result.deliverable.status}`);
  console.log(`Epics          : ${result.deliverable.epics.length}`);
  console.log(`Story packages : ${result.deliverable.storyPackages.length}`);
  console.log(`Mockups        : ${result.deliverable.mockups.length} (fidelity passed: ${result.deliverable.mockups.every((m) => m.fidelityPassed)})`);
  console.log(`Reconcile diff : ${result.reconciled.changes.length} change(s), ${result.reconciled.scopeDeltas.length} scope delta(s)`);
  console.log(`Handoff        : UAT-ready, ${result.handoff.knownBoundaries.length} known boundary(ies)`);
  console.log(`Prototype HTML : ${result.deliverable.mockups.map((m) => m.path).join(", ")}`);
  console.log("\n--- DeliverablePackage ---\n");
  console.log(JSON.stringify(result.deliverable, null, 2));
}

main().catch((err) => {
  console.error(`example failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

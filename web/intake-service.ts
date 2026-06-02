/**
 * intake-service.ts — the engine behind the web front door.
 *
 * Runs the pipeline for a submitted SOW and returns everything the UI needs:
 * the deliverable package, the assumption register, the reconcile diff, the
 * handoff, and the rendered prototype files (written to a per-run directory the
 * server can serve).
 *
 * DEMO MODE: this wires the FixtureRunner, so every submission returns the
 * recorded Zennify Client-360 outputs regardless of the SOW text. Swapping
 * `demoDeps()` for the SdkRunner (once wired) turns this into live generation
 * with no other changes here.
 */
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { run, type RunResult } from "../driver/orchestrator.js";
import {
  FixtureRunner,
  AutoConfirmDiscovery,
  AutoApproveHumanGate,
  type PipelineDeps,
} from "../driver/runner.js";
import { makeFixtures } from "../examples/zennify-client360/fixtures.js";

export interface IntakeRequest {
  sowText: string;
  sowRef?: string;
  runsRoot: string;
}

export interface PrototypeRef {
  title: string;
  file: string;
}

export interface IntakeResult {
  mode: "demo" | "live";
  runId: string;
  sowRef: string;
  result: RunResult;
  prototypes: PrototypeRef[];
}

/** Demo dependencies: recorded fixtures + auto discovery/approval. */
function demoDeps(sowRef: string, outDir: string): PipelineDeps {
  return {
    runner: new FixtureRunner(makeFixtures({ sowRef, writePrototypes: true, outDir })),
    discovery: new AutoConfirmDiscovery(),
    humanGate: new AutoApproveHumanGate(),
  };
}

export async function runIntake(req: IntakeRequest): Promise<IntakeResult> {
  if (!req.sowText.trim()) throw new Error("SOW text is empty.");

  const runId = randomUUID();
  const outDir = join(req.runsRoot, runId);
  const sowRef = req.sowRef?.trim() || `INTAKE-${runId.slice(0, 8)}`;

  const result = await run({ sowRef, sowText: req.sowText }, demoDeps(sowRef, outDir));

  const htmlFiles = (await readdir(outDir)).filter((f) => f.endsWith(".html"));
  const prototypes: PrototypeRef[] = htmlFiles
    .sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)))
    .map((file) => ({ title: file.replace(/\.html$/, "").replace(/-/g, " "), file }));

  return { mode: "demo", runId, sowRef, result, prototypes };
}

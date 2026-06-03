/**
 * intake-service.ts — the engine behind the web front door.
 *
 * Runs the pipeline for a submitted SOW and returns everything the UI needs:
 * the deliverable package, the assumption register, the reconcile diff, the
 * handoff, and the rendered prototype files (written to a per-run directory the
 * server can serve).
 *
 * DEMO MODE: wires the FixtureRunner, so every submission returns the recorded
 * Zennify Client-360 outputs regardless of the SOW text, and runs the FULL
 * pipeline (the build/qa/handoff stages are satisfied by fixtures).
 *
 * LIVE MODE (INTAKE_LIVE=1 + credentials): runs real agents but only the PLAN
 * PHASE (parse → … → reconcile + prototype) — no DX MCP / org required. This is
 * the hardened front half; the grounded build is the Phase-2 path.
 */
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { run, runPlanPhase, type PlanResult, type RunResult } from "../driver/orchestrator.js";
import {
  FixtureRunner,
  SdkRunner,
  AutoConfirmDiscovery,
  AutoApproveHumanGate,
  type PipelineDeps,
} from "../driver/runner.js";
import { makeFixtures } from "../examples/zennify-client360/fixtures.js";

/** Live mode requires opt-in AND credentials; otherwise we stay in demo mode. */
export function isLiveMode(): boolean {
  return (
    process.env.INTAKE_LIVE === "1" &&
    Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN)
  );
}

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
  /** Demo runs the full pipeline (handoff present); live runs the plan phase only. */
  result: PlanResult & { handoff?: RunResult["handoff"] };
  prototypes: PrototypeRef[];
}

/** Demo dependencies: recorded fixtures + auto discovery/approval. */
function demoDeps(): PipelineDeps {
  return {
    runner: new FixtureRunner(makeFixtures()),
    discovery: new AutoConfirmDiscovery(),
    humanGate: new AutoApproveHumanGate(),
  };
}

/**
 * Live dependencies: real agents via the Agent SDK. Discovery/gates are
 * auto-resolved here because the web flow is unattended — a real engagement
 * would route the discovery agenda back to the client instead.
 */
function liveDeps(cwd: string): PipelineDeps {
  return {
    // Web live mode runs the plan phase only (no org), so disable MCP — the
    // designer grounds from the SOW + fsc-patterns instead of spawning an
    // unauthenticated Salesforce DX MCP. Mirrors the CLI --plan-only path.
    runner: new SdkRunner({ cwd, disableMcp: true }),
    discovery: new AutoConfirmDiscovery(),
    humanGate: new AutoApproveHumanGate(),
  };
}

export async function runIntake(req: IntakeRequest): Promise<IntakeResult> {
  if (!req.sowText.trim()) throw new Error("SOW text is empty.");

  const runId = randomUUID();
  const outDir = join(req.runsRoot, runId);
  const sowRef = req.sowRef?.trim() || `INTAKE-${runId.slice(0, 8)}`;
  const live = isLiveMode();
  const runInput = { sowRef, sowText: req.sowText, prototypeOut: { dir: outDir } };

  // Live = real agents, front half only (no org). Demo = full pipeline via fixtures.
  const result = live
    ? await runPlanPhase(runInput, liveDeps(process.cwd()))
    : await run(runInput, demoDeps());

  // The driver renders prototypes into outDir in both demo and live mode;
  // tolerate a missing dir defensively.
  const htmlFiles = await readdir(outDir).catch(() => [] as string[]);
  const prototypes: PrototypeRef[] = htmlFiles
    .filter((f) => f.endsWith(".html"))
    .sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)))
    .map((file) => ({ title: file.replace(/\.html$/, "").replace(/-/g, " "), file }));

  return { mode: live ? "live" : "demo", runId, sowRef, result, prototypes };
}

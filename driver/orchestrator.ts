/**
 * orchestrator.ts — the deterministic shell.
 *
 * Plain code, no model in the loop. For each stage the driver: (1) invokes the
 * subagent, (2) validates the agent's output against its contract schema — a
 * failed parse HALTS the pipeline at that seam instead of corrupting downstream
 * work — and (3) runs the stage's gate. Humans sit at the two irreversible
 * decision points (architect + handoff) and at the fidelity confirm.
 *
 * The ONLY place a live model runs is `invokeSubagent`, isolated behind one
 * function so the moving Agent SDK surface is quarantined (ARCHITECTURE.md §2).
 * Everything around it is real and typechecks against the contracts.
 */
import { z } from "zod";
import {
  SowItem,
  Epic,
  UserStory,
  StoryPackage,
  DesignNote,
  BuildResult,
  QaResult,
  HandoffPackage,
  GateResult,
  DeliverablePackage,
} from "./contracts.js";
import { V1, V2, Assumption, type AssumptionVerdict } from "./v1-reconcile.js";
import {
  buildAssumptionAgenda,
  applyVerdicts,
  blockingAssumptionsRemain,
} from "./discovery.js";
import {
  evaluateDeployTestGate,
  evaluateFidelityGate,
} from "../gates/gate-lib.js";

/* --------------------------------------------------------------- gate plumbing */

type Gate<O> = (output: O) => GateResult | Promise<GateResult>;

/** Infer the parsed (output) type of a zod schema. */
type Out<S extends z.ZodTypeAny> = z.infer<S>;

/** Raised when an agent's output doesn't satisfy its contract — halts at the seam. */
export class ContractViolation extends Error {
  constructor(stage: string, readonly issues: z.ZodError) {
    super(`Contract violation at stage '${stage}': ${issues.message}`);
    this.name = "ContractViolation";
  }
}

/** Raised when an automated gate blocks progression. */
export class GateBlocked extends Error {
  constructor(readonly result: GateResult) {
    super(`Gate '${result.gate}' blocked: ${result.failures.join("; ")}`);
    this.name = "GateBlocked";
  }
}

/* ------------------------------------------------------------------ subagent IO */

/**
 * The single seam to the live model. Stubbed for the scaffold.
 *
 * TODO(sdk): wire @anthropic-ai/claude-agent-sdk here — load the subagent named
 * `agent` from .claude/agents/<agent>.md, run it with `input` serialized as the
 * prompt, and return the parsed JSON it emits. Verify the SDK signature against
 * current docs before relying on it (SDK ~0.2.x is moving).
 */
async function invokeSubagent(agent: string, _input: unknown): Promise<unknown> {
  throw new Error(
    `invokeSubagent('${agent}') is not wired yet — connect the Agent SDK in driver/orchestrator.ts.`,
  );
}

/* ----------------------------------------------------------------- stage runner */

interface Stage<S extends z.ZodTypeAny> {
  name: string;
  agent: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: S;
  gate?: Gate<Out<S>>;
}

/**
 * Run one stage end to end: validate the inbound artifact, invoke the agent,
 * validate the outbound artifact against its contract, then run the gate. A
 * `requiresHuman` gate pauses for an out-of-band approval; an automated gate
 * that fails halts the pipeline. Generic over the output schema so the parsed
 * (output) type flows through — note zod `.default()` fields are optional on a
 * schema's input but required on its output.
 */
async function runStage<S extends z.ZodTypeAny>(stage: Stage<S>, input: unknown): Promise<Out<S>> {
  stage.inputSchema.parse(input); // inbound seam check

  const raw = await invokeSubagent(stage.agent, input);

  const parsed = stage.outputSchema.safeParse(raw);
  if (!parsed.success) throw new ContractViolation(stage.name, parsed.error);
  const output = parsed.data;

  if (stage.gate) {
    const result = await stage.gate(output);
    if (!result.passed) throw new GateBlocked(result);
    if (result.requiresHuman) await awaitHumanApproval(result);
  }

  return output;
}

/**
 * Human-gate pause. In headless runs this is where the driver parks the job and
 * waits for an out-of-band approval (architect / handoff sign-off, fidelity
 * confirm). Stubbed: the scaffold treats a reached human gate as a clean pause
 * point rather than auto-approving.
 *
 * TODO(human-gate): persist state and surface the artifact for review; resume on
 * the recorded verdict.
 */
async function awaitHumanApproval(gate: GateResult): Promise<void> {
  throw new Error(
    `Human gate '${gate.gate}' reached — driver paused for sign-off (wire the review/resume loop here).`,
  );
}

/* ---------------------------------------------------------------------- gates */

const fidelityGate: Gate<{ passes: boolean }> = (report) =>
  GateResult.parse(evaluateFidelityGate(report as Record<string, unknown>));

const architectGate: Gate<V2> = (v2) =>
  GateResult.parse({
    gate: "architect",
    passed: v2.base.status === "reconciled",
    failures:
      v2.base.status === "reconciled"
        ? []
        : ["package is not reconciled; resolve discovery before the architect gate"],
    requiresHuman: true, // a human dispositions the deltas and flips architectApproved
  });

const deployTestGate: Gate<QaResult> = (qa) =>
  GateResult.parse(evaluateDeployTestGate(qa as unknown as Record<string, unknown>));

const handoffGate: Gate<HandoffPackage> = (pkg) =>
  GateResult.parse({
    gate: "handoff",
    passed: pkg.knownBoundaries.length > 0, // honesty is mandatory; UAT-ready, not signed-off
    failures: pkg.knownBoundaries.length > 0 ? [] : ["handoff package omits known boundaries"],
    requiresHuman: true,
  });

/* ------------------------------------------------------- a minimal fidelity shape */

// proto-fidelity emits { passes, violations[] }; only `passes` is needed at the seam.
const FidelityReport = z.object({
  passes: z.boolean(),
  violations: z
    .array(z.object({ element: z.string(), reason: z.string(), severity: z.string() }))
    .default([]),
});
type FidelityReport = z.infer<typeof FidelityReport>;

/* ----------------------------------------------------------------- the pipeline */

export interface RunInput {
  sowRef: string;
  sowText: string;
}

export interface RunResult {
  deliverable: DeliverablePackage;
  reconciled: V2;
  handoff: HandoffPackage;
}

/**
 * Drive a signed SOW to a client-ready handoff package, per the §1 flow:
 *
 *   parse → plan → stories → design ──► (prototype: layout → build → fidelity*)
 *        └─► DISCOVERY (human loop) → reconcile* → build → qa → handoff*
 *
 * (* = gated). Stages are sequenced and seam-checked here; the actual agent work
 * happens behind `invokeSubagent`. The discovery loop iterates Sprint-0 style
 * until no blocking assumption remains.
 */
export async function run(input: RunInput): Promise<RunResult> {
  // ---- Plan ----------------------------------------------------------------
  const sowItems = await runStage(
    { name: "parse", agent: "parser", inputSchema: z.string(), outputSchema: z.array(SowItem) },
    input.sowText,
  );

  const epics = await runStage(
    { name: "plan", agent: "planner", inputSchema: z.array(SowItem), outputSchema: z.array(Epic) },
    sowItems,
  );

  const stories: UserStory[] = [];
  for (const epic of epics) {
    const epicStories = await runStage(
      { name: "stories", agent: "story-writer", inputSchema: Epic, outputSchema: z.array(UserStory) },
      epic,
    );
    stories.push(...epicStories);
  }

  // designer emits the story packages, cross-cutting design notes, and the
  // assumption register that seeds discovery.
  const DesignerOutput = z.object({
    storyPackages: z.array(StoryPackage),
    epicDesigns: z.array(DesignNote),
    assumptions: z.array(Assumption),
  });
  const design = await runStage(
    { name: "design", agent: "designer", inputSchema: z.array(UserStory), outputSchema: DesignerOutput },
    stories,
  );

  // ---- Prototype sub-pipeline ---------------------------------------------
  // layout → build → fidelity (gated) → walkthrough. The prototype's mockups and
  // assumption panel are the v0 strawman the client reacts to in discovery.
  // (Agent invocations run behind invokeSubagent; output shapes elided in the
  // scaffold beyond what the fidelity gate needs.)
  await runStage(
    {
      name: "fidelity",
      agent: "proto-fidelity",
      inputSchema: z.unknown(),
      outputSchema: FidelityReport,
      gate: fidelityGate,
    },
    {},
  );

  let deliverable: DeliverablePackage = DeliverablePackage.parse({
    sowRef: input.sowRef,
    generatedOn: new Date().toISOString(),
    epics,
    storyPackages: design.storyPackages,
    epicDesigns: design.epicDesigns,
    mockups: [],
    assumptionRegisterRef: `${input.sowRef}::assumptions`,
    status: "v0_strawman",
  });

  // ---- Discovery (human loop) ---------------------------------------------
  let assumptions: Assumption[] = design.assumptions;
  do {
    const agenda = buildAssumptionAgenda(deliverable, assumptions);
    const verdicts: AssumptionVerdict[] = await collectDiscoveryVerdicts(agenda);
    assumptions = applyVerdicts(assumptions, verdicts);
    deliverable = { ...deliverable, status: "in_discovery" };
  } while (blockingAssumptionsRemain(assumptions));

  // ---- Reconcile (architect gate) -----------------------------------------
  const v1: V1 = V1.parse({ package: deliverable, assumptions });
  const reconciled = await runStage(
    { name: "reconcile", agent: "reconciler", inputSchema: V1, outputSchema: V2, gate: architectGate },
    v1,
  );
  deliverable = reconciled.base;

  // ---- Grounded build → QA (deploy-test gate) → handoff (handoff gate) -----
  const builds: BuildResult[] = [];
  for (const designNote of deliverable.epicDesigns) {
    const build = await runStage(
      { name: "build", agent: "builder", inputSchema: DesignNote, outputSchema: BuildResult },
      designNote,
    );
    builds.push(build);
  }

  let lastHandoff: HandoffPackage | undefined;
  for (const build of builds) {
    const qa = await runStage(
      { name: "qa", agent: "qa", inputSchema: BuildResult, outputSchema: QaResult, gate: deployTestGate },
      build,
    );
    lastHandoff = await runStage(
      { name: "handoff", agent: "handoff", inputSchema: QaResult, outputSchema: HandoffPackage, gate: handoffGate },
      qa,
    );
  }

  if (!lastHandoff) {
    throw new Error("Pipeline produced no handoff package — no buildable design notes were present.");
  }

  return { deliverable, reconciled, handoff: lastHandoff };
}

/**
 * Discovery is a human + client loop, not an agent. In a headless run the driver
 * emits the agenda and parks until verdicts come back through the intake surface.
 *
 * TODO(discovery): surface the agenda + prototype to the client and collect
 * AssumptionVerdict[]; resume here.
 */
async function collectDiscoveryVerdicts(
  agenda: ReturnType<typeof buildAssumptionAgenda>,
): Promise<AssumptionVerdict[]> {
  throw new Error(
    `Discovery loop reached for ${agenda.sowRef} (${agenda.blockingCount} blocking) — wire the client confirm/correct surface here.`,
  );
}

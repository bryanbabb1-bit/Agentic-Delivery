/**
 * orchestrator.ts — the deterministic shell.
 *
 * Plain code, no model in the loop. For each stage the driver: (1) invokes the
 * subagent (via the injected runner), (2) validates the agent's output against
 * its contract schema — a failed parse HALTS the pipeline at that seam instead
 * of corrupting downstream work — and (3) runs the stage's gate. Humans sit at
 * the two irreversible decision points (architect + handoff) and at the
 * fidelity confirm.
 *
 * The three impure seams — the live model, the discovery loop, and the human
 * gates — are injected (see runner.ts). Production defaults pause/throw until
 * wired; tests inject deterministic implementations so the whole pipeline runs
 * end to end with no model and no org. Everything else here is real and
 * typechecks against the contracts.
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
  Mockup,
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
import { defaultDeps, type PipelineDeps } from "./runner.js";

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
async function runStage<S extends z.ZodTypeAny>(
  stage: Stage<S>,
  input: unknown,
  deps: PipelineDeps,
): Promise<Out<S>> {
  stage.inputSchema.parse(input); // inbound seam check

  const raw = await deps.runner.run(stage.agent, input);

  const parsed = stage.outputSchema.safeParse(raw);
  if (!parsed.success) throw new ContractViolation(stage.name, parsed.error);
  const output = parsed.data;

  if (stage.gate) {
    const result = await stage.gate(output);
    if (!result.passed) throw new GateBlocked(result);
    if (result.requiresHuman) await deps.humanGate.approve(result);
  }

  return output;
}

/* ----------------------------------------- prototype-stage shapes (loose contracts) */

const ScreenInventory = z.object({
  screens: z.array(
    z.object({
      name: z.string(),
      subtitle: z.string().optional(),
      storyIds: z.array(z.string()).default([]),
      objects: z.array(z.string()).default([]),
      fields: z.array(z.string()).default([]),
      fieldValues: z.record(z.string()).optional(),
      highlights: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
      relatedLists: z
        .array(
          z.object({
            title: z.string(),
            columns: z.array(z.string()),
            rows: z.array(z.array(z.string())),
          }),
        )
        .optional(),
      interactions: z.array(z.string()).default([]),
    }),
  ),
});

// proto-fidelity emits { passes, violations[] }; only `passes` is needed at the seam.
const FidelityReport = z.object({
  passes: z.boolean(),
  violations: z
    .array(z.object({ element: z.string(), reason: z.string(), severity: z.string() }))
    .default([]),
});

const Walkthrough = z.object({ scriptPath: z.string() });

// designer emits the story packages, cross-cutting design notes, and the
// assumption register that seeds discovery.
const DesignerOutput = z.object({
  storyPackages: z.array(StoryPackage),
  epicDesigns: z.array(DesignNote),
  assumptions: z.array(Assumption),
});

/* ---------------------------------------------------------------------- gates */

const fidelityGate: Gate<z.infer<typeof FidelityReport>> = (report) =>
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
 *   parse → plan → stories → design
 *        → (prototype: layout → build → fidelity* → walkthrough)
 *        → DISCOVERY (human loop) → reconcile* → build → qa* → handoff*
 *
 * (* = gated). Stages are sequenced and seam-checked here; the actual agent work
 * happens behind the injected runner. The discovery loop iterates Sprint-0 style
 * until no blocking assumption remains.
 */
export async function run(
  input: RunInput,
  depsOverride: Partial<PipelineDeps> = {},
): Promise<RunResult> {
  const deps: PipelineDeps = { ...defaultDeps(), ...depsOverride };

  // ---- Plan ----------------------------------------------------------------
  const sowItems = await runStage(
    { name: "parse", agent: "parser", inputSchema: z.string(), outputSchema: z.array(SowItem) },
    input.sowText,
    deps,
  );

  const epics = await runStage(
    { name: "plan", agent: "planner", inputSchema: z.array(SowItem), outputSchema: z.array(Epic) },
    sowItems,
    deps,
  );

  const stories: UserStory[] = [];
  for (const epic of epics) {
    const epicStories = await runStage(
      { name: "stories", agent: "story-writer", inputSchema: Epic, outputSchema: z.array(UserStory) },
      epic,
      deps,
    );
    stories.push(...epicStories);
  }

  const design = await runStage(
    { name: "design", agent: "designer", inputSchema: z.array(UserStory), outputSchema: DesignerOutput },
    stories,
    deps,
  );

  // ---- Prototype sub-pipeline ---------------------------------------------
  // layout → build → fidelity (gated) → walkthrough. The mockups + assumption
  // panel are the v0 strawman the client reacts to in discovery.
  const inventory = await runStage(
    { name: "layout", agent: "proto-layout", inputSchema: z.unknown(), outputSchema: ScreenInventory },
    { designNotes: design.epicDesigns, stories },
    deps,
  );

  const mockups = await runStage(
    { name: "prototype", agent: "proto-build", inputSchema: ScreenInventory, outputSchema: z.array(Mockup) },
    inventory,
    deps,
  );

  await runStage(
    {
      name: "fidelity",
      agent: "proto-fidelity",
      inputSchema: z.unknown(),
      outputSchema: FidelityReport,
      gate: fidelityGate,
    },
    { mockups, designNotes: design.epicDesigns },
    deps,
  );

  await runStage(
    { name: "walkthrough", agent: "proto-walkthrough", inputSchema: z.unknown(), outputSchema: Walkthrough },
    { mockups, assumptions: design.assumptions },
    deps,
  );

  // Fidelity passed → stamp the mockups.
  const fidelityPassedMockups = mockups.map((m) => ({ ...m, fidelityPassed: true }));

  let deliverable: DeliverablePackage = DeliverablePackage.parse({
    sowRef: input.sowRef,
    generatedOn: new Date().toISOString(),
    epics,
    storyPackages: design.storyPackages,
    epicDesigns: design.epicDesigns,
    mockups: fidelityPassedMockups,
    assumptionRegisterRef: `${input.sowRef}::assumptions`,
    status: "v0_strawman",
  });

  // ---- Discovery (human loop) ---------------------------------------------
  let assumptions: Assumption[] = design.assumptions;
  do {
    const agenda = buildAssumptionAgenda(deliverable, assumptions);
    const verdicts: AssumptionVerdict[] = await deps.discovery.collectVerdicts(agenda);
    assumptions = applyVerdicts(assumptions, verdicts);
    deliverable = { ...deliverable, status: "in_discovery" };
  } while (blockingAssumptionsRemain(assumptions));

  // ---- Reconcile (architect gate) -----------------------------------------
  const v1: V1 = V1.parse({ package: deliverable, assumptions });
  const reconciled = await runStage(
    { name: "reconcile", agent: "reconciler", inputSchema: V1, outputSchema: V2, gate: architectGate },
    v1,
    deps,
  );
  deliverable = reconciled.base;

  // ---- Grounded build → QA (deploy-test gate) → handoff (handoff gate) -----
  const builds: BuildResult[] = [];
  for (const designNote of deliverable.epicDesigns) {
    const build = await runStage(
      { name: "build", agent: "builder", inputSchema: DesignNote, outputSchema: BuildResult },
      designNote,
      deps,
    );
    builds.push(build);
  }

  let lastHandoff: HandoffPackage | undefined;
  for (const build of builds) {
    const qa = await runStage(
      { name: "qa", agent: "qa", inputSchema: BuildResult, outputSchema: QaResult, gate: deployTestGate },
      build,
      deps,
    );
    lastHandoff = await runStage(
      { name: "handoff", agent: "handoff", inputSchema: QaResult, outputSchema: HandoffPackage, gate: handoffGate },
      qa,
      deps,
    );
  }

  if (!lastHandoff) {
    throw new Error("Pipeline produced no handoff package — no buildable design notes were present.");
  }

  return { deliverable, reconciled, handoff: lastHandoff };
}

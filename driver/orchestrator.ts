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
  SolutionDesign,
  DesignNote,
  BuildResult,
  QaResult,
  HandoffPackage,
  GateResult,
  Mockup,
  DeliverablePackage,
} from "./contracts.js";
import { V1, V2, Assumption, ChangeItem, ScopeDelta, type AssumptionVerdict } from "./v1-reconcile.js";
import {
  buildAssumptionAgenda,
  applyVerdicts,
  blockingAssumptionsRemain,
} from "./discovery.js";
import { evaluateDeployTestGate } from "../gates/gate-lib.js";
import { defaultDeps, type PipelineDeps } from "./runner.js";
import { renderPrototype, writePrototype, slug } from "./prototype.js";

/* --------------------------------------------------------------- gate plumbing */

type Gate<O> = (output: O) => GateResult | Promise<GateResult>;

/** Infer the parsed (output) type of a zod schema. */
type Out<S extends z.ZodTypeAny> = z.infer<S>;

/** Raised when an agent's output doesn't satisfy its contract — halts at the seam. */
export class ContractViolation extends Error {
  constructor(readonly stage: string, readonly issues: z.ZodError, readonly raw?: unknown) {
    const got = raw === undefined ? "" : ` | got: ${JSON.stringify(raw).slice(0, 600)}`;
    super(`Contract violation at stage '${stage}': ${issues.message}${got}`);
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
  label?: string,
): Promise<Out<S>> {
  stage.inputSchema.parse(input); // inbound seam check

  await deps.progress?.report({ stage: stage.name, agent: stage.agent, kind: "agent", status: "start", detail: label });
  const raw = await deps.runner.run(stage.agent, input);

  const parsed = stage.outputSchema.safeParse(raw);
  if (!parsed.success) {
    await deps.progress?.report({ stage: stage.name, agent: stage.agent, kind: "agent", status: "blocked", detail: "contract violation" });
    throw new ContractViolation(stage.name, parsed.error, raw);
  }
  const output = parsed.data;
  await deps.progress?.report({ stage: stage.name, agent: stage.agent, kind: "agent", status: "done", detail: label });

  if (stage.gate) {
    await deps.progress?.report({ stage: stage.name, agent: stage.agent, kind: "gate", status: "start" });
    const result = await stage.gate(output);
    if (!result.passed) {
      await deps.progress?.report({ stage: stage.name, agent: stage.agent, kind: "gate", status: "blocked", detail: `${result.failures.length} issue(s)` });
      throw new GateBlocked(result);
    }
    await deps.progress?.report({ stage: stage.name, agent: stage.agent, kind: "gate", status: "done" });
    if (result.requiresHuman) await deps.humanGate.approve(result);
  }

  return output;
}

/* ----------------------------------------- prototype-stage shapes (loose contracts) */

// Prototype cell value: the layout agent naturally emits nulls (empty fields) and
// numbers (amounts/counts) as well as strings. The renderer coerces all of these
// to display text, so accept them here rather than failing the (cosmetic) layout.
const Cell = z.union([z.string(), z.number(), z.boolean()]).nullable();

const ScreenInventory = z.object({
  screens: z.array(
    z.object({
      name: z.string(),
      subtitle: z.string().optional(),
      objectLabel: z.string().optional(), // friendly object name for the header chip
      actions: z.array(z.string()).default([]), // header action buttons (Edit, New Case, …)
      storyIds: z.array(z.string()).default([]),
      objects: z.array(z.string()).default([]),
      fields: z.array(z.string()).default([]),
      fieldValues: z.record(Cell).optional(),
      highlights: z.array(z.object({ label: z.string(), value: Cell })).optional(),
      relatedLists: z
        .array(
          z.object({
            title: z.string(),
            columns: z.array(z.string()),
            rows: z.array(z.array(Cell)),
          }),
        )
        .optional(),
      interactions: z.array(z.string()).default([]),
    }),
  ),
});

// proto-fidelity emits { passes, violations[] }. Each violation's `kind`
// distinguishes a true over-promise (blocks) from an open assumption (expected
// pre-discovery; surfaced in the panel, does not block) — see evaluateFidelityGate.
const FidelityReport = z.object({
  passes: z.boolean(),
  violations: z
    .array(
      z.object({
        element: z.string(),
        reason: z.string(),
        severity: z.string(),
        kind: z.enum(["over_promise", "open_assumption"]).optional(),
        mockupId: z.string().optional(), // which mockup the finding belongs to (e.g. "MOCK-05")
      }),
    )
    .default([]),
});

const Walkthrough = z.object({ scriptPath: z.string() });

// designer emits per-story SolutionDesigns (keyed by storyId), cross-cutting
// design notes, and the assumption register that seeds discovery. It does NOT
// re-echo the stories — the orchestrator owns assembling the story packages from
// the already-validated stories, so a garbled echo can't corrupt them.
const DesignerOutput = z.object({
  solutionDesigns: z.array(SolutionDesign),
  epicDesigns: z.array(DesignNote),
  assumptions: z.array(Assumption),
});

// reconciler emits ONLY the diff (audit trail + scope deltas), NOT the whole
// package — the orchestrator already holds the v1 package and assembles v2 from
// it. Echoing a 40-story package back was the fragile part that broke extraction.
// Tolerant of how the model expresses "nothing changed": a bare array is read as
// the changes list (so `[]` => an empty diff), null/anything-else => empty diff.
const ReconcilerDiff = z.preprocess(
  (v) => (Array.isArray(v) ? { changes: v } : v && typeof v === "object" ? v : {}),
  z.object({
    changes: z.array(ChangeItem).default([]),
    scopeDeltas: z.array(ScopeDelta).default([]),
  }),
);

/* ---------------------------------------------------------------------- gates */

// Fidelity is handled inline in the prototype sub-pipeline (over-promising screens
// are excluded, not gated to a halt) — see planPhase. The remaining gates:

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
  /** When set, the driver renders the prototype HTML into this directory. */
  prototypeOut?: { dir: string };
}

/** The front-half output: the deliverable package the client reacts to. */
export interface PlanResult {
  deliverable: DeliverablePackage;
  /** The post-discovery assumption register (confirmed/corrected). */
  assumptions: Assumption[];
  reconciled: V2;
}

/** The full pipeline output: the plan phase plus the grounded build's handoff. */
export interface RunResult extends PlanResult {
  handoff: HandoffPackage;
}

/** Safety bound so a non-converging discovery loop can't spin forever. */
const MAX_DISCOVERY_ROUNDS = 6;

/**
 * Drive a signed SOW to a client-ready handoff package, per the §1 flow:
 *
 *   parse → plan → stories → design
 *        → (prototype: layout → build → fidelity* → walkthrough)
 *        → DISCOVERY (human loop) → reconcile* → build → qa* → handoff*
 *
 * (* = gated). Stages are sequenced and seam-checked here; the actual agent work
 * happens behind the injected runner. The discovery loop iterates Sprint-0 style
 * until no blocking assumption remains (bounded by MAX_DISCOVERY_ROUNDS).
 */
async function planPhase(input: RunInput, deps: PipelineDeps): Promise<PlanResult> {
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
  for (const [i, epic] of epics.entries()) {
    const epicStories = await runStage(
      { name: "stories", agent: "story-writer", inputSchema: Epic, outputSchema: z.array(UserStory) },
      epic,
      deps,
      `${epic.id}, ${i + 1}/${epics.length}`,
    );
    stories.push(...epicStories);
  }

  const design = await runStage(
    { name: "design", agent: "designer", inputSchema: z.array(UserStory), outputSchema: DesignerOutput },
    stories,
    deps,
  );

  // Assemble story packages from the already-validated stories + the designer's
  // per-story SolutionDesigns (matched by storyId). A story with no returned
  // design degrades to null rather than failing the stage.
  const designByStory = new Map(design.solutionDesigns.map((sd) => [sd.storyId, sd]));
  const storyPackages = stories.map((story) =>
    StoryPackage.parse({ story, solutionDesign: designByStory.get(story.id) ?? null }),
  );

  // ---- Prototype sub-pipeline ---------------------------------------------
  // layout (agent → structured inventory) → fidelity classifies each screen →
  // the DRIVER renders ONLY the fidelity-clean screens. A screen that over-promises
  // (depicts a capability FSC can't build natively in scope) is EXCLUDED from the
  // client prototype and recorded as a finding — the guardrail keeps its teeth
  // without dead-ending the whole package. Rendering lives in the driver (reliable
  // structure, identical demo/live); the mockups + assumption panel are the v0
  // strawman the client reacts to in discovery.
  const inventory = await runStage(
    { name: "layout", agent: "proto-layout", inputSchema: z.unknown(), outputSchema: ScreenInventory },
    { designNotes: design.epicDesigns, stories },
    deps,
  );

  const protoDir = input.prototypeOut?.dir;
  const allMockups = inventory.screens.map((screen, i) =>
    Mockup.parse({
      id: `MOCK-${String(i + 1).padStart(2, "0")}`,
      title: screen.name,
      path: `${protoDir ?? "prototypes"}/${slug(screen.name)}.html`,
      relatedStoryIds: screen.storyIds,
      screens: [screen.name],
      fidelityPassed: false,
    }),
  );

  const fidelity = await runStage(
    { name: "fidelity", agent: "proto-fidelity", inputSchema: z.unknown(), outputSchema: FidelityReport },
    { mockups: allMockups, designNotes: design.epicDesigns, assumptions: design.assumptions },
    deps,
  );

  // Over-promises (anything not an open_assumption) exclude their screen. Match a
  // violation to a mockup by explicit id or by the mockup id appearing in the text.
  const overPromises = fidelity.violations.filter((v) => v.kind !== "open_assumption");
  const excludedIds = new Set(
    allMockups
      .filter((m) => overPromises.some((v) => v.mockupId === m.id || (v.element ?? "").includes(m.id)))
      .map((m) => m.id),
  );
  const keptScreens = inventory.screens.filter((_, i) => !excludedIds.has(allMockups[i]!.id));
  const fidelityPassedMockups = allMockups
    .filter((m) => !excludedIds.has(m.id))
    .map((m) => ({ ...m, fidelityPassed: true }));

  // Render only the fidelity-clean screens.
  if (protoDir) {
    await deps.progress?.report({ stage: "prototype", agent: "(driver)", kind: "render", status: "start", detail: `${keptScreens.length} screen(s)` });
    const files = renderPrototype({ sowRef: input.sowRef, screens: keptScreens, assumptions: design.assumptions });
    await writePrototype(protoDir, files);
    await deps.progress?.report({ stage: "prototype", agent: "(driver)", kind: "render", status: "done" });
  }

  // Fidelity confirm: record the over-promise findings (which screens were excluded
  // and why); a human reviews them, or an unattended run auto-approves.
  await deps.progress?.report({
    stage: "fidelity", agent: "(review)", kind: "gate", status: "done",
    detail: excludedIds.size ? `${excludedIds.size} screen(s) excluded as over-promises` : "all screens clean",
  });
  await deps.humanGate.approve(
    GateResult.parse({
      gate: "fidelity",
      passed: true,
      failures: overPromises.map((v) => `excluded ${v.mockupId ?? "screen"}: ${v.element}`),
      requiresHuman: true,
    }),
  );

  await runStage(
    { name: "walkthrough", agent: "proto-walkthrough", inputSchema: z.unknown(), outputSchema: Walkthrough },
    { mockups: fidelityPassedMockups, assumptions: design.assumptions },
    deps,
  );

  let deliverable: DeliverablePackage = DeliverablePackage.parse({
    sowRef: input.sowRef,
    generatedOn: new Date().toISOString(),
    epics,
    storyPackages,
    epicDesigns: design.epicDesigns,
    mockups: fidelityPassedMockups,
    assumptionRegisterRef: `${input.sowRef}::assumptions`,
    status: "v0_strawman",
  });

  // ---- Discovery (human loop) ---------------------------------------------
  // Iterates Sprint-0 style until no blocking assumption remains, bounded so a
  // provider that never resolves a blocker fails loudly instead of hanging.
  let assumptions: Assumption[] = design.assumptions;
  let round = 0;
  do {
    if (++round > MAX_DISCOVERY_ROUNDS) {
      const remaining = assumptions.filter((a) => a.blocking).map((a) => a.id).join(", ");
      throw new Error(
        `Discovery did not converge after ${MAX_DISCOVERY_ROUNDS} rounds; blocking assumptions remain: ${remaining || "(none reported)"}.`,
      );
    }
    const blockingCount = assumptions.filter((a) => a.blocking).length;
    await deps.progress?.report({ stage: "discovery", agent: "(human loop)", kind: "discovery", status: "start", detail: `round ${round}, ${blockingCount} blocking` });
    const agenda = buildAssumptionAgenda(deliverable, assumptions);
    const verdicts: AssumptionVerdict[] = await deps.discovery.collectVerdicts(agenda);
    assumptions = applyVerdicts(assumptions, verdicts);
    deliverable = { ...deliverable, status: "in_discovery" };
    await deps.progress?.report({ stage: "discovery", agent: "(human loop)", kind: "discovery", status: "done" });
  } while (blockingAssumptionsRemain(assumptions));

  // ---- Reconcile (architect gate) -----------------------------------------
  // The reconciler returns only the diff; the orchestrator assembles v2 from the
  // package it already holds (status -> reconciled). This keeps the agent's output
  // small and reliable instead of re-echoing the whole package.
  const v1: V1 = V1.parse({ package: deliverable, assumptions });
  const diff = await runStage(
    { name: "reconcile", agent: "reconciler", inputSchema: V1, outputSchema: ReconcilerDiff },
    v1,
    deps,
  );
  const reconciled: V2 = V2.parse({
    base: { ...deliverable, status: "reconciled" },
    changes: diff.changes,
    scopeDeltas: diff.scopeDeltas,
    status: "reconciled",
  });

  // Architect gate (human dispositions the scope deltas).
  await deps.progress?.report({ stage: "reconcile", agent: "architect", kind: "gate", status: "start" });
  const gate = await architectGate(reconciled);
  if (!gate.passed) {
    await deps.progress?.report({ stage: "reconcile", agent: "architect", kind: "gate", status: "blocked", detail: `${gate.failures.length} issue(s)` });
    throw new GateBlocked(gate);
  }
  await deps.progress?.report({ stage: "reconcile", agent: "architect", kind: "gate", status: "done" });
  if (gate.requiresHuman) await deps.humanGate.approve(gate);

  return { deliverable: reconciled.base, assumptions, reconciled };
}

/**
 * Run only the front half — parse → … → reconcile — and return the deliverable
 * package the client reacts to. Needs no Salesforce org, so this is the seam to
 * test/iterate on before the grounded build is wired. (Build/QA/handoff are the
 * Phase-2 path; see `run`.)
 */
export async function runPlanPhase(
  input: RunInput,
  depsOverride: Partial<PipelineDeps> = {},
): Promise<PlanResult> {
  return planPhase(input, { ...defaultDeps(), ...depsOverride });
}

/**
 * Drive a signed SOW all the way to a client-ready handoff: the plan phase, then
 * the grounded build → QA (deploy-test gate) → handoff (handoff gate).
 */
export async function run(
  input: RunInput,
  depsOverride: Partial<PipelineDeps> = {},
): Promise<RunResult> {
  const deps: PipelineDeps = { ...defaultDeps(), ...depsOverride };
  const plan = await planPhase(input, deps);

  // ---- Grounded build → QA (deploy-test gate) → handoff (handoff gate) -----
  const builds: BuildResult[] = [];
  for (const designNote of plan.deliverable.epicDesigns) {
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

  return { ...plan, handoff: lastHandoff };
}

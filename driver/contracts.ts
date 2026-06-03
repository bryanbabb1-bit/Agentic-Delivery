/**
 * contracts.ts — The typed contract layer.
 *
 * Every handoff between stages is one of these schemas. The orchestrator
 * validates input AND output at each stage boundary, so a malformed artifact
 * halts the pipeline at the seam instead of silently corrupting downstream work.
 *
 * This is the single most important file for repeatability.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ shared */

export const Persona = z.enum([
  "Advisor",
  "ClientService",
  "Compliance",
  "Operations",
  "SystemAdmin",
  "SolutionArchitect",
]);
export type Persona = z.infer<typeof Persona>;

export const ScopeBucket = z.enum([
  "buildable", // Zennify owns design + build + test + deploy
  "analysis", // feeds design, not itself a build
  "methodology", // process/ceremony, not a buildable unit
  "customer_owned", // out of scope; advise only
]);

export const ChainFriendliness = z.enum(["high", "medium", "low"]);

/* --------------------------------------------------------------- stage 0/1 */

export const SowItem = z.object({
  id: z.string(), // SOW-01
  title: z.string(),
  description: z.string(),
  bucket: ScopeBucket,
  assumptions: z.array(z.string()).default([]),
  chainFriendliness: ChainFriendliness,
  flags: z.array(z.string()).default([]), // early warnings the parser raises
});
export type SowItem = z.infer<typeof SowItem>;

export const Epic = z.object({
  id: z.string(), // EP-08
  title: z.string(),
  sowItemId: z.string(), // must trace back to a SowItem
  personas: z.array(Persona).min(1),
  acceptanceTheme: z.string(),
});
export type Epic = z.infer<typeof Epic>;

/* ----------------------------------------------------------------- stage 2 */

export const AcceptanceCriterion = z.object({
  given: z.string().min(1),
  when: z.string().min(1),
  then: z.string().min(1),
});

export const StoryStatus = z.enum([
  "draft",
  "ready",
  "in_design",
  "in_build",
  "in_qa",
  "done",
  "blocked",
]);

export const UserStory = z
  .object({
    id: z.string(), // US-08.1
    epicId: z.string(),
    persona: Persona,
    asA: z.string(),
    iWant: z.string(),
    soThat: z.string(),
    acceptanceCriteria: z.array(AcceptanceCriterion).min(1),
    status: StoryStatus,
    dependencies: z.array(z.string()).default([]),
    blockingFlags: z.array(z.string()).default([]), // e.g. "Discovery: 15 data points undefined"
  })
  .superRefine((s, ctx) => {
    // Invariant: a story cannot be "ready" while it carries blocking flags.
    if (s.status === "ready" && s.blockingFlags.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Story ${s.id} is 'ready' but has ${s.blockingFlags.length} unresolved blocking flag(s).`,
      });
    }
  });
export type UserStory = z.infer<typeof UserStory>;

/* ----------------------------------------------------------------- stage 3 */

export const AutomationChoice = z.enum([
  "config",
  "validation_rule",
  "flow",
  "apex",
  "omnistudio",
  "mixed",
]);

/** Salesforce metadata component types (shared by SD and BuildResult). */
export const MetadataType = z.enum([
  "object",
  "field",
  "record_type",
  "validation_rule",
  "flow",
  "apex_class",
  "apex_test",
  "lwc",
  "omniscript",
  "permission_set",
  "permission_set_group",
  "sharing_rule",
  "action_plan_template",
  "rollup",
  "page_layout",
  "flexipage",
  "compact_layout",
  "quick_action",
]);

/**
 * Story-level solution design. SD now travels WITH the story (a "story
 * package" = story + AC + SD). The epic-level DesignNote below holds only
 * cross-cutting concerns. Populated in the design stage, once a story is "ready".
 */
export const SolutionDesign = z.object({
  storyId: z.string(),
  approach: z.string(), // narrative: how this story is built on-platform
  automation: AutomationChoice,
  components: z
    .array(
      z.object({
        type: MetadataType,
        apiName: z.string(),
        action: z.enum(["create", "modify", "reuse"]),
      }),
    )
    .default([]),
  testApproach: z.string().optional(), // how QA will verify — ties back to the ACs
  notes: z.string().optional(),
});
export type SolutionDesign = z.infer<typeof SolutionDesign>;

/** The delivery unit the team consumes: a story with its AC and its SD. */
export const StoryPackage = z.object({
  story: UserStory,
  solutionDesign: SolutionDesign.nullable(), // null until the design stage runs
});
export type StoryPackage = z.infer<typeof StoryPackage>;

export const DesignDecision = z.object({
  question: z.string(), // the open question (often straight from the SOW)
  decision: z.string(),
  rationale: z.string(),
});

/**
 * Epic-level design — CROSS-CUTTING concerns only (shared data model, shared
 * automation, integration contracts). Per-story design now lives in
 * SolutionDesign on each StoryPackage.
 */
export const DesignNote = z.object({
  id: z.string(),
  epicId: z.string(),
  storyIds: z.array(z.string()).min(1),
  decisions: z.array(DesignDecision).default([]),
  dataModel: z
    .array(
      z.object({
        object: z.string(),
        fields: z.array(z.string()),
        notes: z.string().optional(),
      }),
    )
    .default([]),
  automation: AutomationChoice,
  integrationContract: z.string().optional(), // published contract for customer-owned integrations
  dependencies: z.array(z.string()).default([]),
  architectApproved: z.boolean().default(false), // flipped only at Gate 1
});
export type DesignNote = z.infer<typeof DesignNote>;

/* ----------------------------------------------------------------- stage 4 */

export const BuildArtifact = z.object({
  type: MetadataType,
  apiName: z.string(),
});

export const BuildResult = z.object({
  designNoteId: z.string(),
  targetOrg: z.string(), // scratch org / sandbox alias
  isProduction: z.literal(false), // hard guard: schema rejects any prod build
  artifacts: z.array(BuildArtifact).default([]),
  deploySucceeded: z.boolean(),
  deployErrors: z.array(z.string()).default([]),
});
export type BuildResult = z.infer<typeof BuildResult>;

/* ----------------------------------------------------------------- stage 5 */

export const QaResult = z.object({
  buildRef: z.string(),
  apexCoveragePct: z.number().min(0).max(100).nullable(), // null for pure-config deliverables
  flowTestsPassed: z.boolean(),
  sitChecks: z
    .array(
      z.object({
        name: z.string(),
        passed: z.boolean(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  contractVerified: z.boolean(), // persisted structure matches published contract
  defects: z.array(z.string()).default([]),
  uatReady: z.boolean(),
});
export type QaResult = z.infer<typeof QaResult>;

/* ----------------------------------------------------------------- stage 6 */

export const HandoffPackage = z.object({
  epicId: z.string(),
  sandboxesDeployed: z.array(z.string()), // SOW: up to 2
  jiraStoryExport: z.string(), // contracted documentation deliverable
  integrationContracts: z.array(z.string()).default([]),
  sitResults: z.string(),
  knownBoundaries: z.array(z.string()).min(1), // honesty is mandatory
  knowledgeTransferNotes: z.string().optional(),
});
export type HandoffPackage = z.infer<typeof HandoffPackage>;

/* ------------------------------------------------------------------- gates */

export const GateResult = z.object({
  gate: z.string(),
  passed: z.boolean(),
  failures: z.array(z.string()).default([]),
  requiresHuman: z.boolean().default(false),
});
export type GateResult = z.infer<typeof GateResult>;

/* ----------------------------------------------------- intake deliverable */

/** One generated HTML/SLDS mockup. The layout agent decides coverage. */
export const Mockup = z.object({
  id: z.string(),
  title: z.string(),
  path: z.string(), // generated HTML file
  relatedStoryIds: z.array(z.string()).default([]),
  screens: z.array(z.string()).default([]), // e.g. ["Client Profile", "Funding"]
  fidelityPassed: z.boolean().default(false), // set by the fidelity gate
});
export type Mockup = z.infer<typeof Mockup>;

/**
 * The artifact the delivery team receives from the intake process — the entire
 * team-facing output. Agents/orchestration/gates are not represented here
 * because the team never sees them. Built pre-discovery; iterated through it.
 */
export const DeliverablePackage = z.object({
  sowRef: z.string(),
  generatedOn: z.string(),
  epics: z.array(Epic),
  storyPackages: z.array(StoryPackage), // stories + AC + SD
  epicDesigns: z.array(DesignNote), // cross-cutting only
  mockups: z.array(Mockup), // as many as make sense
  assumptionRegisterRef: z.string(), // pointer to the v1-reconcile Assumption[]
  status: z.enum(["v0_strawman", "in_discovery", "reconciled"]),
});
export type DeliverablePackage = z.infer<typeof DeliverablePackage>;

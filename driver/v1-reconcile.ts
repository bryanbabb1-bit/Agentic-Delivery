/**
 * v1-reconcile.ts — the assumption register and the post-discovery diff.
 *
 * The design stage emits a v1 DeliverablePackage plus an Assumption[] register:
 * the guesses the agents had to make where the SOW was silent. Discovery is a
 * human + client loop that returns a verdict on each assumption. The reconciler
 * consumes (v1 + AssumptionVerdict[]) and produces v2 — the same package with a
 * ChangeItem[] audit trail and any ScopeDelta[] surfaced for the architect gate.
 *
 * These schemas are referenced by ARCHITECTURE.md §3 (reconciler IO) and by
 * DeliverablePackage.assumptionRegisterRef in contracts.ts, but live here so the
 * contract layer stays focused on the per-stage handoffs.
 */
import { z } from "zod";
import { DeliverablePackage } from "./contracts.js";

/* --------------------------------------------------------- assumption register */

/**
 * A guess the design stage had to make because the SOW was silent or ambiguous.
 * `blocking` assumptions stop a story from being "ready" until discovery resolves
 * them; the register is what the prototype's assumption panel renders.
 */
export const Assumption = z.object({
  id: z.string(), // ASM-01
  topic: z.string(), // short label, e.g. "Funding source field"
  statement: z.string(), // the guess, stated plainly so a human can confirm/correct it
  basis: z.string(), // why we guessed this (SOW excerpt, FSC default, prior art)
  blocking: z.boolean(), // true → a story depends on resolving this before build
  relatedStoryIds: z.array(z.string()).default([]),
});
export type Assumption = z.infer<typeof Assumption>;

/* ------------------------------------------------------------- discovery output */

/** The human/client decision on a single assumption, returned from discovery. */
export const AssumptionVerdict = z.object({
  assumptionId: z.string(),
  verdict: z.enum(["confirm", "correct"]),
  correction: z.string().optional(), // required-by-convention when verdict === "correct"
}).superRefine((v, ctx) => {
  if (v.verdict === "correct" && !v.correction?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Verdict for ${v.assumptionId} is 'correct' but carries no correction text.`,
    });
  }
});
export type AssumptionVerdict = z.infer<typeof AssumptionVerdict>;

/* ----------------------------------------------------------------- reconcile diff */

/** A scope change discovery surfaced — dispositioned by the human at the architect gate. */
export const ScopeDelta = z.object({
  id: z.string(), // SD-01
  kind: z.enum(["added", "removed", "changed"]),
  sowItemId: z.string().optional(), // the SowItem this touches, if any
  description: z.string(),
  impact: z.string(), // effort / risk / dependency note for the architect
});
export type ScopeDelta = z.infer<typeof ScopeDelta>;

/** A concrete edit the reconciler applied to the package as a result of discovery. */
export const ChangeItem = z.object({
  id: z.string(), // CH-01
  targetType: z.enum(["story", "design", "mockup"]),
  targetId: z.string(),
  change: z.string(), // what changed
  reason: z.string(), // which verdict / delta drove it (traceability)
});
export type ChangeItem = z.infer<typeof ChangeItem>;

/* --------------------------------------------------------------------- v1 / v2 */

/** The pre-discovery snapshot: the strawman package plus the assumptions behind it. */
export const V1 = z.object({
  package: DeliverablePackage,
  assumptions: z.array(Assumption),
});
export type V1 = z.infer<typeof V1>;

/** The reconciled result: v1 advanced through discovery, with a full audit trail. */
export const V2 = z.object({
  base: DeliverablePackage, // the package after edits (status: "reconciled")
  changes: z.array(ChangeItem).default([]),
  scopeDeltas: z.array(ScopeDelta).default([]),
  status: z.literal("reconciled"),
});
export type V2 = z.infer<typeof V2>;

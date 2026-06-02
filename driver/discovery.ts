/**
 * discovery.ts — helpers for the human + client discovery loop.
 *
 * Discovery is NOT an agent. The driver emits an agenda from the prototype +
 * Assumption[], the prototype is walked through with the client, and confirm/
 * correct verdicts come back as AssumptionVerdict[]. This module owns the small,
 * deterministic pieces around that loop: building the agenda, applying verdicts,
 * and deciding whether another Sprint-0 pass is needed.
 */
import { z } from "zod";
import {
  Assumption,
  type AssumptionVerdict,
} from "./v1-reconcile.js";
import type { DeliverablePackage } from "./contracts.js";

/** A single line item the client is asked to confirm or correct. */
export const AgendaItem = z.object({
  assumptionId: z.string(),
  topic: z.string(),
  prompt: z.string(), // the question put to the client
  blocking: z.boolean(),
  relatedStoryIds: z.array(z.string()).default([]),
});
export type AgendaItem = z.infer<typeof AgendaItem>;

/** The full discovery agenda, blocking items first so they get airtime. */
export const AssumptionAgenda = z.object({
  sowRef: z.string(),
  items: z.array(AgendaItem),
  blockingCount: z.number().int().min(0),
});
export type AssumptionAgenda = z.infer<typeof AssumptionAgenda>;

/**
 * Build the confirm/correct agenda the human walks through with the client.
 * Blocking assumptions sort to the top — they gate the build, so they must be
 * resolved this session.
 */
export function buildAssumptionAgenda(
  pkg: DeliverablePackage,
  assumptions: Assumption[],
): AssumptionAgenda {
  const items: AgendaItem[] = [...assumptions]
    .sort((a, b) => Number(b.blocking) - Number(a.blocking))
    .map((a) => ({
      assumptionId: a.id,
      topic: a.topic,
      prompt: `${a.statement} — confirm, or correct? (basis: ${a.basis})`,
      blocking: a.blocking,
      relatedStoryIds: a.relatedStoryIds,
    }));

  return {
    sowRef: pkg.sowRef,
    items,
    blockingCount: items.filter((i) => i.blocking).length,
  };
}

/**
 * Fold the client's verdicts back onto the register. A "confirm" leaves the
 * assumption but clears its blocking status (it is now a settled fact); a
 * "correct" rewrites the statement with the client's correction and likewise
 * unblocks it. Assumptions with no verdict are returned untouched — they remain
 * open and will reappear on the next agenda.
 */
export function applyVerdicts(
  assumptions: Assumption[],
  verdicts: AssumptionVerdict[],
): Assumption[] {
  const byId = new Map(verdicts.map((v) => [v.assumptionId, v]));
  return assumptions.map((a) => {
    const verdict = byId.get(a.id);
    if (!verdict) return a;
    if (verdict.verdict === "confirm") {
      return { ...a, blocking: false };
    }
    return {
      ...a,
      statement: verdict.correction ?? a.statement,
      basis: `Corrected in discovery (was: ${a.statement})`,
      blocking: false,
    };
  });
}

/**
 * The Sprint-0 termination predicate: discovery iterates until no blocking
 * assumption remains open. The driver loops on this before allowing reconcile
 * to advance toward the architect gate.
 */
export function blockingAssumptionsRemain(assumptions: Assumption[]): boolean {
  return assumptions.some((a) => a.blocking);
}

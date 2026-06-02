/**
 * runner.ts — the injectable seams.
 *
 * The orchestrator is deterministic, but three things are NOT pure code: the
 * live model (subagent invocation), the human discovery loop, and the human
 * gates. Rather than hard-stub them, they are injected as dependencies. The
 * production defaults are the real seams (they pause/throw until wired); tests
 * and the worked example inject deterministic implementations so the whole
 * pipeline runs end to end with no model and no org.
 */
import type { AssumptionAgenda } from "./discovery.js";
import type { AssumptionVerdict } from "./v1-reconcile.js";
import type { GateResult } from "./contracts.js";

/* ---------------------------------------------------------------- interfaces */

/** Invokes a Claude Code subagent and returns the JSON it emits. */
export interface SubagentRunner {
  run(agent: string, input: unknown): Promise<unknown>;
}

/** Collects the client's confirm/correct verdicts for a discovery agenda. */
export interface DiscoveryProvider {
  collectVerdicts(agenda: AssumptionAgenda): Promise<AssumptionVerdict[]>;
}

/** Records a human's approval at a `requiresHuman` gate (architect / handoff / fidelity). */
export interface HumanGate {
  approve(gate: GateResult): Promise<void>;
}

export interface PipelineDeps {
  runner: SubagentRunner;
  discovery: DiscoveryProvider;
  humanGate: HumanGate;
}

/* --------------------------------------------------- production seams (default) */

/**
 * The real model seam. Stubbed for the scaffold.
 *
 * TODO(sdk): wire @anthropic-ai/claude-agent-sdk — load the subagent named
 * `agent` from .claude/agents/<agent>.md, run it with `input` serialized as the
 * prompt, parse the JSON it emits, and return it. Verify the SDK signature
 * against current docs first (SDK ~0.2.x is moving; note the zod peer).
 */
export class SdkRunner implements SubagentRunner {
  async run(agent: string, _input: unknown): Promise<unknown> {
    throw new Error(
      `SdkRunner.run('${agent}') is not wired yet — connect the Agent SDK in driver/runner.ts.`,
    );
  }
}

/** Headless default: parks the job when discovery is reached. */
export class PausingDiscovery implements DiscoveryProvider {
  async collectVerdicts(agenda: AssumptionAgenda): Promise<AssumptionVerdict[]> {
    throw new Error(
      `Discovery loop reached for ${agenda.sowRef} (${agenda.blockingCount} blocking) — wire the client confirm/correct surface.`,
    );
  }
}

/** Headless default: parks the job at a human gate for out-of-band sign-off. */
export class PausingHumanGate implements HumanGate {
  async approve(gate: GateResult): Promise<void> {
    throw new Error(`Human gate '${gate.gate}' reached — driver paused for sign-off.`);
  }
}

export function defaultDeps(): PipelineDeps {
  return {
    runner: new SdkRunner(),
    discovery: new PausingDiscovery(),
    humanGate: new PausingHumanGate(),
  };
}

/* ----------------------------------------------- deterministic seams (testing) */

/**
 * A runner backed by recorded fixtures: one function per agent, `(input) =>
 * output`. Functions (not static blobs) so fixtures for transforming agents
 * (reconciler, builder, qa) can echo/derive from their input and keep the
 * pipeline's traceability intact.
 */
export type FixtureMap = Record<string, (input: unknown) => unknown | Promise<unknown>>;

export class FixtureRunner implements SubagentRunner {
  constructor(private readonly fixtures: FixtureMap) {}
  async run(agent: string, input: unknown): Promise<unknown> {
    const fixture = this.fixtures[agent];
    if (!fixture) throw new Error(`FixtureRunner: no fixture registered for agent '${agent}'`);
    return fixture(input);
  }
}

/** Confirms every assumption on the agenda — clears the discovery loop in one pass. */
export class AutoConfirmDiscovery implements DiscoveryProvider {
  async collectVerdicts(agenda: AssumptionAgenda): Promise<AssumptionVerdict[]> {
    return agenda.items.map((item) => ({
      assumptionId: item.assumptionId,
      verdict: "confirm" as const,
    }));
  }
}

/** Auto-approves human gates — for tests/examples only. */
export class AutoApproveHumanGate implements HumanGate {
  async approve(_gate: GateResult): Promise<void> {
    /* no-op */
  }
}

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
import { loadAgent, buildUserPrompt, extractJson } from "./agent-loader.js";

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

export interface SdkRunnerOptions {
  /** Where the subagent .md files live (defaults to .claude/agents). */
  agentsDir?: string;
  /** Working directory for the Agent SDK process. */
  cwd?: string;
}

/**
 * The live model seam: runs each subagent via the Agent SDK
 * (`@anthropic-ai/claude-agent-sdk`). Loads the agent's `.md`, runs it single-
 * shot with built-in tools disabled and filesystem settings isolated, reads the
 * `result` message, and extracts the JSON the agent emitted.
 *
 * SCOPE: this wires the text-in/JSON-out (plan) stages. Tool-using stages
 * (builder/qa via DX MCP, handoff via Jira, prototype file-writing) need their
 * tools + MCP granted — that's the Phase-2 follow-up (see DECISIONS.md).
 *
 * NOTE: unverified in CI/sandbox — the SDK spawns the Claude Code process and
 * needs Anthropic credentials. Validate signatures + message handling on a
 * credentialed machine before relying on it.
 */
export class SdkRunner implements SubagentRunner {
  constructor(private readonly opts: SdkRunnerOptions = {}) {}

  async run(agent: string, input: unknown): Promise<unknown> {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      throw new Error(
        `SdkRunner needs Anthropic credentials (set ANTHROPIC_API_KEY) to run agent '${agent}' live.`,
      );
    }

    const def = await loadAgent(agent, this.opts.agentsDir);
    const { query } = await import("@anthropic-ai/claude-agent-sdk");

    const q = query({
      prompt: buildUserPrompt(input),
      options: {
        ...(def.model ? { model: def.model } : {}),
        systemPrompt: def.systemPrompt,
        tools: [], // plan stages need no built-in tools; Phase 2 grants per-agent
        settingSources: [], // isolation: don't load project settings/hooks here
        maxTurns: 1,
        ...(this.opts.cwd ? { cwd: this.opts.cwd } : {}),
      },
    });

    let resultText: string | undefined;
    for await (const message of q) {
      if (message.type === "result") {
        if (message.subtype === "success") resultText = message.result;
        else throw new Error(`agent '${agent}' run failed (${message.subtype}).`);
      }
    }

    if (resultText === undefined) {
      throw new Error(`agent '${agent}' returned no result message.`);
    }
    return extractJson(resultText);
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

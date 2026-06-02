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
import { loadMcpServers, mcpServerName, type McpServerMap } from "./mcp-config.js";

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
  /** Path to the MCP config (defaults to .mcp.json). */
  mcpConfigPath?: string;
  /** Working directory for the Agent SDK process. */
  cwd?: string;
  /**
   * No-org mode: don't wire MCP servers. The front half (plan → … → reconcile)
   * needs no Salesforce org (ARCHITECTURE.md §8). With this set, an agent whose
   * only tools are MCP servers (e.g. the designer's read-only DX grounding) runs
   * single-shot instead of trying to spawn an unauthenticated MCP; built-in
   * tools (e.g. proto-walkthrough's `Write`) are unaffected.
   */
  disableMcp?: boolean;
}

/** Turns let a tool-using agent call tools and respond; plan agents are single-shot. */
const TOOL_AGENT_MAX_TURNS = 16;

/**
 * The live model seam: runs each subagent via the Agent SDK
 * (`@anthropic-ai/claude-agent-sdk`). Loads the agent's `.md`, runs it, reads
 * the `result` message, and extracts the JSON the agent emitted.
 *
 * - **Plan stages** (no tools): single-shot, built-in tools disabled.
 * - **Tool-using stages**: the agent's declared tools are granted — built-ins
 *   (e.g. `Write`) via `tools`/`allowedTools`, and MCP servers (e.g.
 *   `mcp__salesforce-dx`, `mcp__jira`) wired from `.mcp.json`. The DX MCP is how
 *   `builder`/`qa` touch a real scratch org so the deploy-test gate bites with
 *   real coverage (ARCHITECTURE.md §8).
 *
 * NOTE: the tool-using path is unverified in CI/sandbox — it needs Anthropic
 * credentials, a connected DX MCP, and a target org. Validate on a credentialed
 * machine; never point the DX MCP at production (BuildResult.isProduction is a
 * literal `false`).
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

    const builtinTools = def.tools.filter((t) => !t.startsWith("mcp__"));
    const wantsMcp = def.tools.some((t) => t.startsWith("mcp__"));
    // No-org mode drops MCP grants; an agent left with no usable tools runs single-shot.
    const effectiveTools = this.opts.disableMcp ? builtinTools : def.tools;
    const usesTools = effectiveTools.length > 0;
    const mcpServers =
      wantsMcp && !this.opts.disableMcp ? await this.selectMcpServers(def.tools) : undefined;

    const q = query({
      prompt: buildUserPrompt(input),
      options: {
        ...(def.model ? { model: def.model } : {}),
        systemPrompt: def.systemPrompt,
        tools: builtinTools, // [] for plan agents; e.g. ['Write'] for proto-walkthrough
        ...(usesTools ? { allowedTools: effectiveTools } : {}), // auto-allow, no prompts
        ...(mcpServers && Object.keys(mcpServers).length ? { mcpServers } : {}),
        settingSources: [], // isolation: don't load project settings/hooks here
        maxTurns: usesTools ? TOOL_AGENT_MAX_TURNS : 1,
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

  /** The MCP servers an agent's `mcp__*` tool grants reference, from .mcp.json. */
  private async selectMcpServers(tools: string[]): Promise<McpServerMap> {
    const wanted = new Set(tools.map(mcpServerName).filter((n): n is string => Boolean(n)));
    if (wanted.size === 0) return {};
    const all = await loadMcpServers(this.opts.mcpConfigPath);
    return Object.fromEntries(Object.entries(all).filter(([name]) => wanted.has(name)));
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

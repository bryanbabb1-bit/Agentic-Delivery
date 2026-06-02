# Decision log

A running record of the decisions we've made building **SOW → Ship**, newest
last. Each entry: the decision, the context, and the consequence. Keep it short;
this is memory, not prose.

> Convention: when we change direction, add a new entry rather than rewriting an
> old one — the trail matters.

---

### 2026-06-02 · Repo layout at root
**Decided:** Scaffold at the repository root, not in a nested `sow-to-ship/`
folder (ARCHITECTURE.md §6 showed a nested tree). **Why:** this repo *is* the
project. **Consequence:** `ARCHITECTURE.md → docs/`, `contracts.ts → driver/`.

### 2026-06-02 · Rich content + typed skeleton
**Decided:** Author the agents/skills/config with real content and a driver that
typechecks against the contracts, rather than empty placeholders. **Consequence:**
12 subagents, 5 skills, real hooks/MCP config, and a working driver skeleton.

### 2026-06-02 · Keep zod 3; defer the SDK's zod-4 peer
**Decided:** Pin `zod@3` (what `driver/contracts.ts` is written for) and let the
Agent SDK's `zod@^4` peer resolve via `.npmrc legacy-peer-deps`. **Why:** the SDK
isn't imported on the hot path yet; not worth a contract rewrite. **Consequence:**
reconcile the zod major when the SDK is wired live.

### 2026-06-02 · Determinism via injectable seams
**Decided:** The three impure points — live model, discovery loop, human gates —
are injected (`driver/runner.ts`: `SubagentRunner` / `DiscoveryProvider` /
`HumanGate`). Production defaults pause/throw; fixtures make runs deterministic.
**Consequence:** the whole pipeline runs end-to-end in tests/examples with no
model and no org.

### 2026-06-02 · Prototype rendering is deterministic + self-contained
**Decided:** Generate the HTML prototype from a structured screen inventory via a
pure renderer (`driver/prototype.ts`), and **inline the CSS** (no SLDS CDN).
**Why:** a CDN dependency made pages render blank offline / in sandboxed
previews; deterministic rendering also fits "LLMs reliable at structure, brittle
at pixels." **Consequence:** prototypes render anywhere, no network.

### 2026-06-02 · Make the example legible; add self-QA
**Decided:** Enrich the Client-360 example with realistic data (named client,
balances, goals, activity) and add `npm run qa:screenshot` (Playwright) to render
prototypes to PNGs. **Why:** the prototype read like a schema dump and I was
shipping UI I couldn't see. **Constraint:** this sandbox blocks the browser-binary
download, so screenshots run only where the network allows it.

### 2026-06-02 · End-user surface = web intake (chosen over SDK-first)
**Decided:** Build a browser front door (`web/`) over the pipeline before wiring
live agents. **Why:** answer "how does an end user engage?" concretely. **Status:**
runs in demo mode (fixtures); flips to live by swapping the runner.

### 2026-06-02 · Wire SdkRunner as text→JSON, tools disabled
**Decided:** Implement `SdkRunner` against the Agent SDK `query()` — load each
subagent's `.md`, run single-shot with `tools: []` and `settingSources: []`
(isolation), read the `result` message, extract JSON. **Scope:** this makes the
plan stages (parser → … → reconciler) live-capable. **Deferred to Phase 2:** the
tool-using stages (builder/qa via DX MCP, handoff via Jira, prototype writing),
and moving deterministic prototype rendering into the driver for live mode.
**Constraint:** unverifiable in this sandbox — no `ANTHROPIC_API_KEY` present and
the SDK spawns the Claude Code process; validate on a credentialed machine.

### 2026-06-02 · Phase 2a — prototype rendering moved into the driver
**Decided:** `proto-build` is no longer an LLM subagent. `proto-layout` (agent)
produces the structured screen inventory; the **driver** renders the SLDS HTML
deterministically (`driver/prototype.ts`), writing to `RunInput.prototypeOut.dir`.
**Why:** identical prototypes in demo and live runs, no reliance on an agent's
Write tool, and it fits "structure over pixels." **Consequence:** the
`proto-build.md` file is now documentation of intent, not an invoked agent.

### 2026-06-02 · Phase 2b — SdkRunner grants tools + MCP
**Decided:** For tool-using agents, `SdkRunner` grants built-in tools (e.g.
`Write`) and wires the MCP servers their `mcp__*` grants reference, loaded and
sanitized from `.mcp.json` (`driver/mcp-config.ts` strips the `"//"` comment
keys). Tool agents get multiple turns; plan agents stay single-shot. **Why:** the
DX MCP is how `builder`/`qa` touch a real scratch org so the deploy-test gate
bites with real coverage (§8). **Still deferred / untested:** an actual
`builder`/`qa` run needs a connected DX MCP + a target org (none here); never
point it at production (`BuildResult.isProduction` is a literal `false`).

### 2026-06-02 · Environment constraints (recorded)
This managed sandbox has **no Anthropic credentials** (API reachable, 401) and
**blocks browser-binary downloads** (Playwright/Chromium 403 "Host not in
allowlist"). So live agent runs and visual screenshots must happen in a
credentialed/networked environment; here we verify via types, fixtures, and tests.

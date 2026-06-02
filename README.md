# SOW → Ship

A repeatable pipeline that takes a signed Salesforce SOW and drives it to a
client-ready state through **plan → prototype → discovery → reconcile → grounded
build → QA → handoff**. Specialized Claude Code subagents do the work; a
deterministic Agent SDK driver owns every transition.

Two principles the architecture serves:

1. **Determinism lives in the seams, not the agents.** Typed contracts validate
   every handoff; hooks gate every stage; humans sit at the two irreversible
   decision points.
2. **Put speculative work where agents are strong.** The v1 the client reacts to
   is an HTML/SLDS prototype, not a speculative org build.

And the product principle: **it's an intake process; the agents are invisible.**
SOW in, package out — compiler, not copilot.

> Full design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Layout

| Path | What it is |
|------|------------|
| `intake/` | The front door — the only team-facing surface. `npm run intake -- <sow>`. |
| `.claude/agents/` | The 12 subagents (one per pipeline stage). |
| `.claude/skills/` | The 5 reusable standards (AC format, SLDS, FSC patterns, fidelity rubric, handoff). |
| `.claude/settings.json` | Hooks = the automated gates. |
| `.mcp.json` | Salesforce DX MCP + Jira MCP config (verify signatures — both are moving). |
| `driver/contracts.ts` | The typed contract layer — every handoff is one of these schemas. |
| `driver/v1-reconcile.ts` | Assumption register + post-discovery diff (V1/V2). |
| `driver/discovery.ts` | The human discovery-loop helpers. |
| `driver/runner.ts` | The injectable seams: subagent runner, discovery, human gates (prod defaults + fixture impls). |
| `driver/orchestrator.ts` | The deterministic shell: stage sequencing, validation, gate wiring. |
| `examples/zennify-client360/` | A worked SOW driven end to end with fixtures (no model, no org). |
| `gates/` | The hook scripts (`deploy-test-gate.js`, `fidelity-gate.js`) + shared `gate-lib.js`. |
| `prototypes/` | Generated HTML/SLDS mockup sets (git-ignored). |

## Web intake (the end-user front door)

A browser UI over the pipeline — drop a SOW, get the package summary, the
assumption register, and the clickable prototype embedded, with no agent to
operate.

```bash
npm run web     # then open http://localhost:4317
```

In the page: paste a SOW (or **Load example SOW**) → **Generate package**. Today
this runs in **demo mode** — every submission returns the recorded Zennify
Client-360 outputs regardless of input. It becomes live generation by swapping
the `FixtureRunner` for the `SdkRunner` in `web/intake-service.ts` (one function),
once that seam is wired. The server (`web/server.ts`) is dependency-free Node;
per-submission output lands under `web/.runs/` (git-ignored).

### Going live (real agents)

The live seam is wired (`SdkRunner` in `driver/runner.ts`) against the Agent SDK:
each subagent's `.md` is loaded and run single-shot, JSON in → JSON out. It needs
Anthropic credentials and is **best validated on a credentialed machine** (this
repo's CI/sandbox has none, and the SDK spawns the Claude Code process):

```bash
export ANTHROPIC_API_KEY=...           # required for live runs
npm run intake -- examples/zennify-client360/sow.txt --auto   # CLI, unattended
INTAKE_LIVE=1 npm run web              # web UI flips to live mode
```

Scope: the plan stages run live, and `SdkRunner` now **grants tool-using agents
their tools + MCP servers** (built-ins like `Write`, and `mcp__salesforce-dx` /
`mcp__jira` wired from `.mcp.json`). The DX MCP is how `builder`/`qa` touch a real
scratch org so the deploy-test gate bites with real coverage. **Still untested
end-to-end:** that needs a connected DX MCP + a target org — none in this repo's
sandbox; never point it at production. Prototype HTML is rendered by the driver
(not an agent), so it's identical in demo and live. Without `--auto`/credentials
the pipeline pauses at the discovery loop and human gates by design.

## Decision log

Key choices and their rationale live in [`DECISIONS.md`](DECISIONS.md) — read it
to understand *why* the repo looks the way it does.

## Status: Phase 1 runnable

The structure, contracts, agents, skills, gates, and the deterministic driver are
all in place and typecheck against the contracts. The pipeline **runs end to end
today** — the whole Phase-1 flow (parse → plan → stories → design → prototype →
discovery → reconcile → build → qa → handoff) executes against fixtures, with
every contract validated and every gate enforced.

The three impure points — the live model, the discovery loop, the human gates —
are **injected** (`driver/runner.ts`). The production defaults (`SdkRunner`,
`PausingDiscovery`, `PausingHumanGate`) pause/throw until wired; the worked
example injects deterministic implementations. **The one thing left to wire** is
`SdkRunner.run` (the Agent SDK call) — verify its signature against current docs
(SDK ~0.2.x and the DX MCP Beta are both moving; note the zod peer).

### Run the worked example

```bash
npm run example     # drives examples/zennify-client360 SOW → reconciled package
                    # and renders clickable SLDS HTML into prototypes/
```

`proto-build` renders real Lightning-looking screens (`driver/prototype.ts`):
each screen is a self-contained SLDS page (CSS inlined — renders offline, no CDN)
with highlights, sample record data, related-list tables, and a visible,
contestable assumption panel — the disposable v1 the client reacts to in
discovery. Open `prototypes/index.html` after running the example.

### Visual QA

```bash
npx playwright install chromium   # one-time, where the network allows it
npm run qa:screenshot             # render prototypes/*.html → PNGs for eyeballing
```

## Develop

```bash
npm install
npm run typecheck     # tsc --noEmit against the contracts
npm run test          # vitest — contract invariants
npm run intake -- --help
```

### Gate scripts (run standalone)

```bash
echo '{"deploySucceeded":true,"flowTestsPassed":true,"apexCoveragePct":82,"contractVerified":true}' \
  | node gates/deploy-test-gate.js   # exit 0 = pass, non-zero = blocked
```

## Phased build plan

1. **Phase 1 — Plan + Prototype, no org.** parse → design → prototype → discovery
   → reconcile. Pure text + HTML; no Salesforce connection. Ship first.
2. **Phase 2 — Grounded build + QA** on code-amenable deliverables via DX MCP.
3. **Phase 3 — Broaden the build stage** as DX MCP and Flow generation mature.

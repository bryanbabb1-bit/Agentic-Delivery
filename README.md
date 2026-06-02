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
| `driver/orchestrator.ts` | The deterministic shell: stage sequencing, validation, gate wiring. |
| `gates/` | The hook scripts (`deploy-test-gate.js`, `fidelity-gate.js`) + shared `gate-lib.js`. |
| `prototypes/` | Generated HTML/SLDS mockup sets (git-ignored). |

## Status: scaffold

The structure, contracts, agents, skills, gates, and the typed driver skeleton
are all in place and typecheck against the contracts. **The one stub** is the
live model seam: `invokeSubagent` in `driver/orchestrator.ts` (and the
discovery/human-gate resume loops). Wire the Agent SDK there — verify the
signature against current docs (SDK ~0.2.x and the DX MCP Beta are both moving).

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

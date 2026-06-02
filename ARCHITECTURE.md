# SOW → Ship — Agent Architecture (Claude Code)

**Status:** architecture spec for implementation
**Runtime:** Claude Code (subagents + skills + hooks + MCP), Agent SDK underneath for the deterministic driver
**Validated against:** Zennify SBH FSC Migration SOW

-----

## 1. What this is

A repeatable pipeline that takes a signed Salesforce SOW and drives it to a client-ready state through plan → prototype → discovery → reconcile → grounded build → QA → handoff. Specialized agents do the work; a deterministic shell owns every transition.

Two principles the whole architecture serves:

1. **Determinism lives in the seams, not the agents.** Typed contracts validate every handoff; hooks gate every stage; humans sit at the two irreversible decision points.
1. **Put speculative work where agents are strong.** The v1 the client reacts to is an **HTML/SLDS prototype**, not a speculative org build — because LLMs are reliable at UI and brittle at Salesforce declarative metadata.

And one product principle that shapes the surface:
3. **It is an intake process; the agents are invisible.** The delivery team submits a SOW and receives a deliverable package. They never see, operate, or manage an agent — no subagent wrangling, no orchestration UI. The pipeline is a black box: SOW in, package out. Think compiler, not copilot. Iteration happens by submitting corrections back through the same surface, which silently re-runs the relevant stages.

```
SOW
 │ parse
 ▼
[plan] ── parser → planner → story-writer → designer ──► design + stories + ASSUMPTIONS
 │                                                          │
 │                                            ┌─────────────┴─────────────┐
 │                                            ▼                           │
 │                                   [prototype sub-pipeline]             │
 │                          layout → build(HTML/SLDS) → FIDELITY-CHECK    │
 │                                            │  (adversarial + human)    │
 │                                            ▼                           │
 │                                   clickable v1 + assumption panel      │
 │                                            │                           │
 │                              ╔═════════════▼═══════════════╗           │
 │                              ║   DISCOVERY (human + client) ║          │
 │                              ║  confirm / correct assumptions║         │
 │                              ╚═════════════▼═══════════════╝           │
 │                                            ▼                           │
 │                                   reconciler → v2 + change-set + deltas│
 │                              ╔═════════════▼═══════════════╗           │
 │                              ║   ARCHITECT GATE (human)     ║          │
 │                              ╚═════════════▼═══════════════╝           │
 │                                            ▼                           │
 │                          builder (scratch/sandbox via DX MCP)          │
 │                              ╔═════════════▼═══════════════╗           │
 │                              ║ DEPLOY+TEST GATE (hook,auto) ║          │
 │                              ╚═════════════▼═══════════════╝           │
 │                                            ▼                           │
 │                                   qa (internal SIT via DX MCP)         │
 │                              ╔═════════════▼═══════════════╗           │
 │                              ║   HANDOFF GATE (human)       ║          │
 │                              ╚═════════════▼═══════════════╝           │
 ▼                                            ▼                           │
 └──────────────────────────────────► handoff package ◄──────────────────┘
                                              ▼
                            Customer-led UAT → Training → Go Live
```

-----

## 2. Platform decision (why Claude Code)

|Need                                                         |Claude Code primitive                    |Why it fits                                                                                     |
|-------------------------------------------------------------|-----------------------------------------|------------------------------------------------------------------------------------------------|
|Specialized agents with isolated context/tools               |**Subagents** (`.claude/agents/*.md`)    |Each stage gets its own context window, prompt, model, tool allow-list                          |
|Touch a real Salesforce org                                  |**Salesforce DX MCP Server (Beta)**      |First-class in Claude Code: create scratch orgs, deploy metadata, run Apex/agent tests          |
|Repeatable standards (AC format, SLDS rules, fidelity rubric)|**Skills** (`.claude/skills/*`)          |Versioned, reusable instruction sets the agents load on demand                                  |
|Deterministic gates between stages                           |**Hooks** (`SubagentStop`, `PostToolUse`)|Run code on agent completion; validate output against the contract; block progression on failure|
|Scheduled / CI execution, no human at a terminal             |**Headless / Remote Control**            |Run the pipeline as a job; trigger build+test in CI                                             |
|Files (HTML prototype, design docs, Jira export)             |Native file ops                          |The prototype and deliverables are just files                                                   |

**The nuance:** Claude Code subagents are excellent for interactive, developer-in-the-loop work, but the multi-stage handoff needs hard determinism. So the orchestration backbone is a thin **Agent SDK driver** (`@anthropic-ai/claude-agent-sdk`, which Claude Code is built on) that calls subagents and enforces the contracts/gates in code. Verify SDK and DX MCP signatures against current docs — both are moving (SDK ~0.2.x, DX MCP Beta).

-----

## 3. Agent roster

Each is a Claude Code subagent. `IO` columns name the typed contract (see `contracts.ts` / `v1-reconcile.ts`).

### Plan stages

|Agent         |Model |Tools                        |In → Out                                                                                                  |Autonomy|
|--------------|------|-----------------------------|----------------------------------------------------------------------------------------------------------|--------|
|`parser`      |sonnet|—                            |SOW text → `SowItem[]`                                                                                    |full    |
|`planner`     |opus  |—                            |`SowItem[]` → `Epic[]`                                                                                    |full    |
|`story-writer`|sonnet|—                            |`Epic` → `UserStory[]`                                                                                    |full    |
|`designer`    |opus  |DX MCP (read: metadata, SOQL)|`UserStory[]` → `StoryPackage[]` (per-story SD) + epic-level `DesignNote` (cross-cutting) + `Assumption[]`|full    |

### Prototype sub-pipeline (the “show up with things to show” engine)

|Agent              |Model |Tools     |In → Out                                                                                        |Autonomy             |
|-------------------|------|----------|------------------------------------------------------------------------------------------------|---------------------|
|`proto-layout`     |sonnet|—         |`DesignNote` + stories → screen inventory (objects/fields → screens)                            |full                 |
|`proto-build`      |sonnet|file write|screen inventory → clickable HTML/SLDS prototype + embedded assumption panel                    |full                 |
|`proto-fidelity`   |opus  |—         |prototype + design → fidelity report (flags anything not natively buildable in FSC within scope)|full → **human gate**|
|`proto-walkthrough`|haiku |file write|prototype + assumptions → annotated discovery demo script                                       |full                 |

### Reconcile + build stages

|Agent       |Model |Tools                                  |In → Out                                                             |Autonomy                 |
|------------|------|---------------------------------------|---------------------------------------------------------------------|-------------------------|
|`reconciler`|opus  |—                                      |`V1` + `AssumptionVerdict[]` → `v2` + `ChangeItem[]` + `ScopeDelta[]`|full → **architect gate**|
|`builder`   |opus  |DX MCP (scratch org, deploy, run tests)|approved `DesignNote` → `BuildResult`                                |**supervised**           |
|`qa`        |sonnet|DX MCP (run tests, SOQL)               |`BuildResult` → `QaResult`                                           |full → **handoff gate**  |
|`handoff`   |haiku |Jira MCP, file write                   |`QaResult` → `HandoffPackage`                                        |full                     |

Every agent’s system prompt inherits the house rules: output only schema-valid JSON, **flag gaps rather than invent**, prefer code/config over complex Flows, **never target production**, and trace every artifact to its parent.

**Sample subagent definition** (`.claude/agents/proto-fidelity.md`):

```markdown
---
name: proto-fidelity
description: Adversarially reviews a generated prototype against FSC reality.
model: claude-opus-4-8
tools: []
---
You are the fidelity guardrail. Given a prototype and its DesignNote, identify
every element that could NOT be delivered natively in Financial Services Cloud
within the SOW's scope (custom UI that Lightning/Flow can't match, fields with
no home in the data model, interactions implying out-of-scope automation).
Output JSON: { passes: boolean, violations: [{element, reason, severity}] }.
Assume the prototype is over-promising until proven otherwise.
```

-----

## 4. Orchestration & control flow

The driver is plain code (no model in the loop). For each stage it: (1) invokes the subagent, (2) parses output, (3) **validates against the contract schema** — a failed parse halts the pipeline at that seam, (4) runs the stage’s gate.

**Gates, and how each is implemented:**

|Gate             |Type               |Mechanism                                                     |Pass condition                                                                                         |
|-----------------|-------------------|--------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
|**Fidelity**     |adversarial + human|`proto-fidelity` agent → hook checks `passes` → human confirms|No unresolved over-promise violations                                                                  |
|**Architect**    |human              |Driver pauses; human flips `architectApproved`                |Design/reconcile reviewed; deltas dispositioned                                                        |
|**Deploy + Test**|automated          |`PostToolUse` / `SubagentStop` hook on `builder`+`qa`         |`deploySucceeded` ∧ flow tests pass ∧ (Apex coverage ≥ threshold where Apex exists) ∧ contract verified|
|**Handoff**      |human              |Driver pauses for sign-off                                    |`uatReady` ∧ no open defects                                                                           |

**Sample gate as a hook** (`.claude/settings.json`):

```json
{
  "hooks": {
    "SubagentStop": [{
      "matcher": "builder|qa",
      "hooks": [{ "type": "command", "command": "node ./gates/deploy-test-gate.js" }]
    }]
  }
}
```

The gate script reads the agent’s structured output, applies the boolean logic, and exits non-zero to block progression. Determinism enforced outside the model.

**Discovery** is a human loop, not an agent: the driver emits the assumption agenda (from the prototype + `Assumption[]`), the prototype is shown to the client, confirm/correct verdicts come back as `AssumptionVerdict[]`, and `reconciler` consumes them. It iterates (Sprint-0 style) until no blocking assumptions remain.

-----

## 5. Skills inventory

Encode the standards once; every relevant agent loads them.

|Skill                |Used by          |Encodes                                                                        |
|---------------------|-----------------|-------------------------------------------------------------------------------|
|`zennify-ac-standard`|story-writer     |Given/When/Then format, persona set, Definition of Ready (v1.0)                |
|`slds-fidelity`      |proto-build      |Authentic Lightning look; constrain to FSC-native components; no over-styling  |
|`fsc-patterns`       |designer, builder|FSC data model, Person Accounts, Action Plans, rollups, Flow-vs-Apex heuristics|
|`fidelity-rubric`    |proto-fidelity   |The “buildable-on-platform” checklist the guardrail scores against             |
|`handoff-package`    |handoff          |Contents + the “UAT-ready not signed-off” framing; Jira export shape           |

-----

## 6. Project structure

```
sow-to-ship/
├─ intake/                     # the FRONT DOOR — SOW drop-point / wrapper command;
│                              # the only team-facing surface (agents stay hidden)
├─ .claude/
│  ├─ agents/                  # one subagent .md per agent in §3
│  ├─ skills/                  # the skills in §5
│  └─ settings.json            # hooks = the automated gates
├─ .mcp.json                   # Salesforce DX MCP + Jira MCP config
├─ driver/                     # Agent SDK orchestration (the deterministic shell)
│  ├─ contracts.ts             # Zod schemas — every handoff + DeliverablePackage
│  ├─ v1-reconcile.ts          # assumption register + post-discovery diff
│  ├─ discovery.ts             # agenda / reconcile helpers
│  └─ orchestrator.ts          # stage sequencing, validation, gate wiring
├─ gates/                      # gate scripts invoked by hooks
├─ prototypes/                 # generated HTML/SLDS mockup sets
└─ docs/ARCHITECTURE.md        # this file
```

-----

## 7. Interaction model & execution

The team-facing surface is **intake only**. There is no agent cockpit.

- **Team-facing (the only surface they touch):** submit a SOW (drop the file / run the intake wrapper), receive a `DeliverablePackage` — epics, story packages (AC + SD), the mockup set, and the assumption register. To iterate, they mark assumptions confirm/correct or request changes; that feeds back through the same surface and silently regenerates the affected outputs. They never open an agent.
- **Backstage (hidden):** the subagents, the Agent SDK driver, the contract validation, and the gates all run out of sight. Even the human gates are reviewers approving an *artifact*, not operating an agent — the machinery stays invisible.
- **Headless execution:** the front half (parse → designer → prototype) runs as a job triggered on SOW signature, so the package is waiting before kickoff. The grounded build + QA (Phase 2) runs in CI against a sandbox, gated by the deploy-test hook.

-----

## 8. Phased build plan

1. **Phase 1 — Plan + Prototype, no org.** parser → designer → prototype sub-pipeline → discovery loop → reconcile. Pure text + HTML; needs no Salesforce connection; delivers the “show up with things to show” capability immediately. Highest ROI, lowest risk. Ship this first.
1. **Phase 2 — Grounded build + QA on code-amenable deliverables.** Wire DX MCP; run builder/qa on Apex/config-leaning items (Action Plans, Rollups) so the deploy-test gate bites with real coverage. Keep Flow-heavy items human-built.
1. **Phase 3 — Broaden the build stage** as DX MCP and Flow generation mature; revisit builder autonomy.

-----

## 9. Risks & guardrails

|Risk                                            |Guardrail                                                                                                           |
|------------------------------------------------|--------------------------------------------------------------------------------------------------------------------|
|Prototype over-promises vs. FSC reality         |`proto-fidelity` adversarial agent + human fidelity gate; `slds-fidelity` skill constrains styling                  |
|Anchoring on the prototype / sunk cost          |Frame v1 as disposable; assumption panel keeps guesses visible and contestable; reconciler not biased to preserve v1|
|Declarative metadata (Flows) brittle to generate|`builder` stays **supervised**; deploy-test gate is the safety net; config-heavy items lean human                   |
|Agent targets production                        |`BuildResult.isProduction` is a literal `false` in the schema — unrepresentable by design                           |
|QA mistaken for sign-off                        |Pipeline produces **UAT-ready** only; handoff gate + skill enforce the framing                                      |
|Tooling churn (SDK, DX MCP Beta)                |Pin versions; isolate SDK calls behind one driver function; verify signatures against current docs                  |

```

```
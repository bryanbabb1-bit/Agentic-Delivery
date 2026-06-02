---
name: zennify-ac-standard
description: The Zennify acceptance-criteria standard — story form, persona set, Given/When/Then, and Definition of Ready. Load when writing user stories.
version: 1.0
---
# Zennify Acceptance-Criteria Standard (v1.0)

Used by: `story-writer`. Encode the standard once; the agent loads it on demand.

## Story form

Every story uses:

- **As a** `<persona>`
- **I want** `<capability>`
- **So that** `<outcome>`

## Persona set (canonical)

Use only these personas (they match the `Persona` enum in `driver/contracts.ts`):
`Advisor`, `ClientService`, `Compliance`, `Operations`, `SystemAdmin`,
`SolutionArchitect`. One persona per story.

## Acceptance criteria — Given / When / Then

Each story has **at least one** AC in strict Given/When/Then form:

- **Given** `<precondition / context>`
- **When** `<action the persona takes>`
- **Then** `<observable, testable outcome>`

Each clause is non-empty. The **Then** must be observable so QA can verify it —
no vague "the system works" outcomes. Tie the test approach in the solution
design back to these ACs.

## Definition of Ready

A story is `ready` only when ALL hold:

1. Story form complete (As-a / I-want / So-that all present).
2. At least one full Given/When/Then AC.
3. No undefined data points the build depends on.
4. Dependencies identified.
5. **No blocking flags.** A story carrying any `blockingFlags` cannot be
   `ready` — the contract enforces this. If data points are undefined, leave the
   story `draft` with a blocking flag (e.g. "Discovery: N data points undefined")
   until discovery resolves them.

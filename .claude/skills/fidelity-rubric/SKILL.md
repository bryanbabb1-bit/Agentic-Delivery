---
name: fidelity-rubric
description: The buildable-on-platform checklist the fidelity guardrail scores a prototype against. Load when reviewing prototype fidelity.
---
# Fidelity Rubric

Used by: `proto-fidelity`. The checklist the guardrail scores against. Assume the
prototype is **over-promising until proven otherwise** — the default verdict is
fail.

## Score each element against:

1. **Native UI** — could Lightning / a standard FSC component / a Flow screen
   render this as shown? Custom layouts, bespoke widgets, or interactions
   Lightning can't match are violations.
2. **Data model home** — does every field/section map to an object+field in the
   DesignNote's data model? A field with no home is a violation.
3. **Automation in scope** — does any interaction imply automation
   (integration, complex Flow, Apex) that is outside the SOW's scope? If so,
   violation.
4. **No silent scope creep** — does the screen imply work beyond the stories it
   claims to serve?
5. **Data sensitivity & licensing** — does it expose PII / regulated financial
   data without an access story, or assume an FSC feature/license/edition not in
   scope? Flag it.

## Violation shape

For each problem: `{ element, reason, severity }`.

- **severity** — `high` (the prototype promises something the platform/scope
  cannot deliver), `medium` (deliverable but only with out-of-scope effort),
  `low` (cosmetic over-styling).

## Pass condition

`passes: true` only when there are **no unresolved over-promise violations**.
Any `high` violation fails the gate outright. The human fidelity gate confirms
the call after this automated score.

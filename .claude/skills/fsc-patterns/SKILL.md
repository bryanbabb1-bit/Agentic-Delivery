---
name: fsc-patterns
description: Financial Services Cloud design patterns — data model, Person Accounts, Action Plans, rollups, and Flow-vs-Apex heuristics. Load when designing or building on FSC.
---
# FSC Patterns

Used by: `designer`, `builder`. The shared FSC knowledge that keeps designs and
builds grounded in platform reality.

## Data model

- Prefer the **FSC standard data model** before introducing custom objects:
  Account/Contact (Person Accounts), Financial Accounts, Financial Goals,
  Relationship groups, Action Plans.
- Reuse standard fields before creating custom ones. New fields must trace to a
  story; orphan fields are a gap to flag.

## Person Accounts

- Model individuals as **Person Accounts** where the SOW deals with retail
  clients. Watch the Person-Account-specific behaviors (record types, the
  Account/Contact merge) when designing automation and layouts.

## Action Plans & rollups

- Use **Action Plan Templates** for repeatable, multi-step client processes
  instead of bespoke task automation.
- Use **rollups** (FSC rollup framework / declarative rollups) for aggregations
  before reaching for Apex triggers.

## Flow vs Apex heuristics

Prefer declarative; reach for Apex only when a Flow would be brittle:

- **Config / validation rules** — field defaults, simple validation, page logic.
- **Flow** — straight-line record-triggered or screen automation, low branching,
  no bulk-volume hot paths.
- **Apex** — complex bulk logic, intricate branching, performance-sensitive
  operations, or anything a Flow makes fragile. Pair Apex with `apex_test`
  coverage (the deploy-test gate enforces the threshold where Apex exists).

When in doubt, choose the path that is **easiest to test and hardest to break**,
and record the decision in the DesignNote.

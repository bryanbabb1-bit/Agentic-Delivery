---
name: fsc-patterns
description: Financial Services Cloud + Salesforce platform best practices — data model, security, automation, and test standards. Load when designing or building on FSC.
---
# FSC Patterns & Salesforce Best Practices

Used by: `designer`, `builder`. The house standard that keeps designs and builds
grounded in platform reality. **Declarative-first, secure-by-default, bulk-safe.**

> This is a living standard. A Salesforce-certified architect on the delivery
> team should own and ratify it — treat it as the floor, not the ceiling.

## Data model

- **Reuse the FSC standard model before adding custom objects/fields.** FSC ships
  Account/Contact (Person Accounts), `FinServ__FinancialAccount__c`,
  `FinServ__FinancialGoal__c`, `FinServ__FinancialHolding__c`, Relationship
  Groups / households, and the Actionable Relationship Center (ARC).
- Respect the `FinServ__` managed-package namespace on standard FSC components;
  custom additions get the org's own namespace (or none).
- New fields must trace to a story; orphan fields are a gap to flag, not invent.
- Prefer **record types + page layouts / Dynamic Forms** over custom UI for
  presentation differences.

## Person Accounts

- Model individuals as **Person Accounts** for retail clients. Mind the
  Account/Contact duality (a Person Account is one record exposed as both),
  Person-Account record types, and that some standard Contact features differ.
- Don't assume Person Accounts are enabled — it's irreversible org config; if the
  SOW is silent, record it as a **blocking assumption**.

## Security (secure-by-default — never optional)

- Enforce **CRUD/FLS and sharing**. In Apex use `WITH USER_MODE` (or
  `WITH SECURITY_ENFORCED`) on SOQL and `Security.stripInaccessible` for
  DML; default classes to `with sharing`.
- Surface **PII / financial data sensitivity** (Shield encryption, field audit,
  least-privilege permission sets) — FSC data is regulated. Flag it in the design.
- Grant access via **permission sets / permission set groups**, not profiles.

## Automation — declarative first, then code

Choose the path that is **easiest to test and hardest to break**, and record the
choice + rationale in the DesignNote:

- **Config / validation rules** — defaults, simple validation, Dynamic Forms.
- **Flow** — record-triggered or screen automation with low branching. One
  record-triggered flow per object per timing (before/after) where practical;
  keep logic out of hot bulk paths; bulkify (no per-record callouts/queries).
- **Apex** — complex/bulk logic, intricate branching, performance-sensitive work,
  or anything a Flow makes fragile. Then follow the Apex rules below.
- **OmniStudio** — guided, multi-step interactions; don't reach for it where a
  standard Lightning page or Flow suffices.

## Apex rules (when code is justified)

- **Bulkify everything**: no SOQL/DML inside loops; operate on collections.
- Respect **governor limits**; query selectively (indexed/selective filters).
- **One trigger per object**, delegating to a handler; control recursion. No
  business logic in the trigger body.
- **No hardcoded IDs** (use Custom Metadata / Custom Settings / queries).
- Separation of concerns (service / selector / domain style).
- **Tests are part of done**: meaningful asserts (not just coverage), `@testSetup`,
  `Test.startTest/stopTest`, positive + negative + **bulk (200+ records)** cases,
  no `seeAllData=true`. Coverage ≥ 75% is the floor; aim higher on real logic.

## Aggregations

- Prefer **roll-up summary fields** (master-detail), the FSC rollup framework, or
  **Data Processing Engine / Flow** before Apex triggers for aggregation.

## Action Plans

- Use **Action Plan Templates** for repeatable, multi-step client processes
  instead of bespoke task automation.

## Environments

- **Never target production.** Build in scratch orgs / sandboxes
  (`BuildResult.isProduction` is a literal `false`). Track metadata as source
  (SFDX), not change sets.

---
name: handoff-package
description: Contents, Jira export shape, and "UAT-ready not signed-off" framing for the handoff package. Load when assembling handoff.
---
# Handoff Package

Used by: `handoff`. What the client receives, how it's framed, and the Jira
export shape.

## Contents (maps to `HandoffPackage` in `driver/contracts.ts`)

- **sandboxesDeployed** — the sandbox(es) the work landed in. The SOW allows
  **up to 2**.
- **jiraStoryExport** — the contracted documentation deliverable, exported to
  Jira (see shape below).
- **integrationContracts** — published contracts for any customer-owned
  integrations.
- **sitResults** — the internal SIT outcome summary.
- **knownBoundaries** — what is explicitly NOT covered. **At least one is
  mandatory.** Honesty is the deliverable; the contract rejects an empty list.
- **knowledgeTransferNotes** — optional KT notes for the customer team.

## Jira export shape

Export the epics → stories → acceptance criteria hierarchy:

- Epic → Jira Epic (title, acceptance theme).
- Story → Jira Story (As-a/I-want/So-that, Given/When/Then ACs, status).
- Preserve parent links (story → epic → SOW item) for traceability.

## Framing — UAT-ready, NOT signed-off

The pipeline produces a package fit for **customer-led UAT** — it is **not** a
sign-off and must never imply acceptance. State boundaries plainly. The path
forward is: **customer-led UAT → training → go-live**. The handoff gate enforces
this framing before release.

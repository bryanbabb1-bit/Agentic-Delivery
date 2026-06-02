# intake — the front door

This is the **only** surface the delivery team touches. It is an *intake
process*, not an agent cockpit (ARCHITECTURE.md §7).

## What you do here

1. **Submit** a signed SOW:

   ```bash
   npm run intake -- ./path/to/sow.txt --ref ZEN-FSC-001 --out deliverable.json
   ```

2. **Receive** a `DeliverablePackage` (see `driver/contracts.ts`): epics, story
   packages (AC + solution design), the HTML/SLDS mockup set, and the assumption
   register.

3. **Iterate** by marking assumptions confirm/correct or requesting changes and
   resubmitting through this same surface. The pipeline silently re-runs the
   affected stages.

## What you do NOT do here

You never see, operate, or manage an agent. The subagents, the Agent SDK driver,
the contract validation, and the gates all run backstage. Even the human gates
(architect sign-off, handoff sign-off) are reviewers approving an *artifact* —
not operating an agent.

## Output framing

The package is **UAT-ready, not signed-off**. Known boundaries are stated
explicitly in the handoff. From here the engagement moves to customer-led UAT →
training → go-live.

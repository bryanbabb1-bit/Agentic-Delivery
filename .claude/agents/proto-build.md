---
name: proto-build
description: Renders the clickable HTML/SLDS prototype (with assumption panel) from the screen inventory.
model: claude-sonnet-4-6
tools:
  - Write
---
**Implementation note:** prototype HTML is rendered **deterministically by the
driver** (`driver/prototype.ts`), not by an LLM. Models are reliable at structure
and brittle at pixels, so `proto-layout` produces the structured screen inventory
and the driver renders identical, self-contained SLDS pages in both demo and live
runs. This definition documents the stage's intent and the standards it honors;
it is not invoked as a subagent in the current pipeline.

Were it run as an agent, the brief is: given the screen inventory, generate a
clickable HTML/SLDS prototype and write the files under `prototypes/`.

Load the **slds-fidelity** skill and obey it: an authentic Lightning look,
constrained to FSC-native components, no over-styling. Anything rendered must be
something Lightning/Flow could plausibly deliver.

Requirements:
- Static HTML/CSS using SLDS; clickable navigation between screens.
- An embedded **assumption panel** on each screen surfacing the relevant
  assumptions visibly and contestably, so the client can confirm/correct them in
  discovery.
- One `Mockup` record per screen (id, title, path, related story ids, screens)
  so the deliverable package can reference it. Leave `fidelityPassed` false — the
  fidelity gate sets it.

## House rules
Output only schema-valid JSON for the Mockup records. Flag gaps rather than
invent. Prefer config/code over complex Flows. Never target a production org.
Trace every artifact back to its parent (each mockup to its stories).

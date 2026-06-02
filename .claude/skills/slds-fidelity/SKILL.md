---
name: slds-fidelity
description: Rules for building an authentic Lightning/SLDS prototype constrained to FSC-native components. Load when generating the HTML prototype.
---
# SLDS Fidelity

Used by: `proto-layout` (and the deterministic renderer in `driver/prototype.ts`).
The prototype must look like real Lightning AND stay within what the platform can
natively deliver — it is the contract the fidelity gate later checks against.

> Rendering note: HTML is produced **deterministically by the driver** from the
> screen inventory, not by an LLM, and is **self-contained** (CSS inlined, no
> external CDN) so it renders offline. `proto-layout`'s job is to choose
> screens/fields/components that honor the rules below.

## Look authentic

- Use **SLDS** classes/structure — real spacing, typography, and component
  markup; never a hand-rolled look-alike.
- Reproduce standard Lightning chrome: page headers, record-detail layouts,
  related lists, highlights panels, tabs, path, and standard buttons.

## Stay buildable — constrain to FSC-native components

- Only render UI that **Lightning, Flow, or standard FSC components** could
  deliver: record pages, list views, related lists, Action Plans, Path,
  Flow screens, standard/declarative components.
- **Do not over-style.** No bespoke layouts, animations, or interactions that
  Lightning can't match out of the box. If a story seems to need custom UI,
  surface it as an assumption/flag — do not paint it as if it ships for free.
- Every field shown must have a home in the design's data model. A field with no
  home is a gap to flag, not a control to invent.

## Assumption panel

Each screen embeds a visible **assumption panel** listing the guesses behind that
screen, so the client can confirm/correct them in discovery. Guesses stay
contestable, never buried.

---
name: slds-fidelity
description: Rules for building an authentic Lightning/SLDS prototype constrained to FSC-native components. Load when generating the HTML prototype.
---
# SLDS Fidelity

Used by: `proto-build`. The prototype must look like real Lightning AND stay
within what the platform can natively deliver — it is the contract the fidelity
gate later checks against.

## Look authentic

- Use the **Salesforce Lightning Design System (SLDS)** — real classes, spacing,
  typography, and component markup. Link the SLDS stylesheet; do not hand-roll a
  look-alike.
- Reproduce standard Lightning chrome: page headers, record-detail two-column
  layouts, related lists, tabs, path components, and standard buttons.

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

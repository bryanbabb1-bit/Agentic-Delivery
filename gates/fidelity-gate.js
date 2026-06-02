#!/usr/bin/env node
/**
 * fidelity-gate.js — the adversarial Fidelity gate's automated half (§4).
 *
 * Wired as a SubagentStop hook on `proto-fidelity` in .claude/settings.json.
 * Reads the fidelity report from stdin and blocks when the prototype
 * over-promises against FSC reality. A human still confirms the call
 * (requiresHuman) — this script only enforces the hard "no unresolved
 * violations" floor.
 *
 * Usage: node ./gates/fidelity-gate.js  < fidelityReport.json
 */
import { evaluateFidelityGate, runGateCli } from "./gate-lib.js";

await runGateCli((payload) => evaluateFidelityGate(payload));

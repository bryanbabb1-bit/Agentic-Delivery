#!/usr/bin/env node
/**
 * deploy-test-gate.js — the automated Deploy + Test gate (ARCHITECTURE.md §4).
 *
 * Wired as a SubagentStop hook on `builder|qa` in .claude/settings.json. Reads
 * the agent's structured output from stdin, applies the §4 boolean logic via
 * gate-lib, and exits non-zero to block the pipeline when the build/test bar
 * isn't met. Determinism enforced outside the model.
 *
 * Usage: node ./gates/deploy-test-gate.js  < buildOrQaResult.json
 */
import { evaluateDeployTestGate, runGateCli } from "./gate-lib.js";

await runGateCli((payload) => evaluateDeployTestGate(payload));

/**
 * gate-lib.js — the single source of truth for gate boolean logic.
 *
 * Plain ESM + JSDoc so it can be imported BOTH by the standalone Node hook
 * scripts (`node ./gates/*.js`, wired in .claude/settings.json) AND by the
 * TypeScript orchestrator (driver/orchestrator.ts). The gates ARE the
 * determinism, so the conditions here must mirror ARCHITECTURE.md §4 exactly —
 * keep this the only place the logic lives.
 *
 * @typedef {Object} GateResultShape
 * @property {string} gate
 * @property {boolean} passed
 * @property {string[]} failures
 * @property {boolean} requiresHuman
 */

/** Salesforce's standard production Apex coverage bar. */
export const DEFAULT_APEX_COVERAGE_THRESHOLD = 75;

/**
 * Deploy + Test gate (automated). Mirrors §4:
 *   deploySucceeded ∧ flowTestsPassed ∧ (apexCoveragePct ≥ threshold where Apex
 *   exists) ∧ contractVerified.
 *
 * Tolerant of being handed a BuildResult, a QaResult, or a merged object: each
 * clause only fails when its field is present and violates the condition, so the
 * hook can fire on either the `builder` or `qa` SubagentStop.
 *
 * @param {Record<string, unknown>} payload  builder/qa structured output (merged ok)
 * @param {{ apexCoverageThreshold?: number }} [opts]
 * @returns {GateResultShape}
 */
export function evaluateDeployTestGate(payload, opts = {}) {
  const threshold = opts.apexCoverageThreshold ?? DEFAULT_APEX_COVERAGE_THRESHOLD;
  const failures = [];

  if ("deploySucceeded" in payload && payload.deploySucceeded !== true) {
    const errs = Array.isArray(payload.deployErrors) ? payload.deployErrors : [];
    failures.push(`deploy failed${errs.length ? `: ${errs.join("; ")}` : ""}`);
  }

  if ("flowTestsPassed" in payload && payload.flowTestsPassed !== true) {
    failures.push("flow tests did not pass");
  }

  // Apex coverage only bites where Apex exists (apexCoveragePct === null => pure config).
  const coverage = payload.apexCoveragePct;
  if (typeof coverage === "number" && coverage < threshold) {
    failures.push(`Apex coverage ${coverage}% is below the ${threshold}% threshold`);
  }

  if ("contractVerified" in payload && payload.contractVerified !== true) {
    failures.push("persisted structure does not match the published contract");
  }

  // A production target is unrepresentable by design, but double-check anyway.
  if (payload.isProduction === true) {
    failures.push("build targeted a production org (forbidden)");
  }

  return {
    gate: "deploy-test",
    passed: failures.length === 0,
    failures,
    requiresHuman: false,
  };
}

/**
 * Fidelity gate (adversarial agent + human confirm). The proto-fidelity agent
 * emits { passes, violations: [{element, reason, severity}] }. The automated
 * portion passes only when `passes === true` with no unresolved violations;
 * `requiresHuman` is always true because a human confirms the fidelity call.
 *
 * @param {Record<string, unknown>} report  proto-fidelity structured output
 * @returns {GateResultShape}
 */
export function evaluateFidelityGate(report) {
  const failures = [];
  const violations = Array.isArray(report.violations) ? report.violations : [];

  if (report.passes !== true) {
    failures.push("proto-fidelity reported passes=false");
  }
  for (const v of violations) {
    const element = v && typeof v === "object" ? v.element : undefined;
    const reason = v && typeof v === "object" ? v.reason : undefined;
    failures.push(`over-promise: ${element ?? "?"} — ${reason ?? "unspecified"}`);
  }

  return {
    gate: "fidelity",
    passed: failures.length === 0,
    failures,
    requiresHuman: true,
  };
}

/**
 * Shared CLI harness for the standalone hook scripts: read JSON from stdin,
 * evaluate, print the GateResult, and exit non-zero to BLOCK progression.
 *
 * @param {(payload: Record<string, unknown>) => GateResultShape} evaluator
 * @returns {Promise<void>}
 */
export async function runGateCli(evaluator) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();

  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (err) {
      console.error(`gate: could not parse stdin as JSON — ${String(err)}`);
      process.exit(2);
    }
  }

  const result = evaluator(payload);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.passed ? 0 : 1);
}

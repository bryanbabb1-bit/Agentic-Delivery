/**
 * contracts.test.ts — invariants the contract layer must enforce.
 *
 * These are the determinism guarantees the whole pipeline leans on: a malformed
 * artifact must fail at the seam, the "ready"-with-blocking-flags invariant must
 * reject, and a production build must be unrepresentable.
 */
import { describe, it, expect } from "vitest";
import {
  SowItem,
  UserStory,
  BuildResult,
  DeliverablePackage,
} from "./contracts.js";
import {
  evaluateDeployTestGate,
  evaluateFidelityGate,
} from "../gates/gate-lib.js";

describe("SowItem", () => {
  it("parses a well-formed item", () => {
    const item = {
      id: "SOW-01",
      title: "Migrate FSC data",
      description: "Move client data into FSC.",
      bucket: "buildable",
      chainFriendliness: "high",
    };
    expect(SowItem.parse(item).id).toBe("SOW-01");
  });

  it("rejects an unknown bucket", () => {
    const bad = {
      id: "SOW-02",
      title: "x",
      description: "y",
      bucket: "not-a-bucket",
      chainFriendliness: "high",
    };
    expect(SowItem.safeParse(bad).success).toBe(false);
  });
});

describe("UserStory invariant", () => {
  const base = {
    id: "US-08.1",
    epicId: "EP-08",
    persona: "Advisor" as const,
    asA: "advisor",
    iWant: "a 360 view",
    soThat: "I can serve clients",
    acceptanceCriteria: [{ given: "a client", when: "I open the page", then: "I see the view" }],
    dependencies: [],
  };

  it("rejects a 'ready' story that carries blocking flags", () => {
    const story = { ...base, status: "ready", blockingFlags: ["Discovery: 3 data points undefined"] };
    expect(UserStory.safeParse(story).success).toBe(false);
  });

  it("accepts a 'draft' story with blocking flags", () => {
    const story = { ...base, status: "draft", blockingFlags: ["Discovery: 3 data points undefined"] };
    expect(UserStory.safeParse(story).success).toBe(true);
  });

  it("accepts a 'ready' story with no blocking flags", () => {
    const story = { ...base, status: "ready", blockingFlags: [] };
    expect(UserStory.safeParse(story).success).toBe(true);
  });
});

describe("BuildResult production guard", () => {
  const base = {
    designNoteId: "DN-1",
    targetOrg: "scratch-1",
    deploySucceeded: true,
  };

  it("accepts isProduction: false", () => {
    expect(BuildResult.safeParse({ ...base, isProduction: false }).success).toBe(true);
  });

  it("rejects isProduction: true (unrepresentable by design)", () => {
    expect(BuildResult.safeParse({ ...base, isProduction: true }).success).toBe(false);
  });
});

describe("DeliverablePackage", () => {
  it("parses a minimal v0 strawman", () => {
    const pkg = {
      sowRef: "ZEN-FSC-001",
      generatedOn: new Date().toISOString(),
      epics: [],
      storyPackages: [],
      epicDesigns: [],
      mockups: [],
      assumptionRegisterRef: "ZEN-FSC-001::assumptions",
      status: "v0_strawman",
    };
    expect(DeliverablePackage.parse(pkg).status).toBe("v0_strawman");
  });
});

describe("deploy-test gate logic (§4)", () => {
  it("passes when deploy + tests + coverage + contract all clear", () => {
    const r = evaluateDeployTestGate({
      deploySucceeded: true,
      flowTestsPassed: true,
      apexCoveragePct: 82,
      contractVerified: true,
    });
    expect(r.passed).toBe(true);
  });

  it("passes pure-config builds (null coverage)", () => {
    const r = evaluateDeployTestGate({
      deploySucceeded: true,
      flowTestsPassed: true,
      apexCoveragePct: null,
      contractVerified: true,
    });
    expect(r.passed).toBe(true);
  });

  it("blocks when Apex coverage is below threshold", () => {
    const r = evaluateDeployTestGate({
      deploySucceeded: true,
      flowTestsPassed: true,
      apexCoveragePct: 60,
      contractVerified: true,
    });
    expect(r.passed).toBe(false);
  });

  it("blocks a failed deploy", () => {
    const r = evaluateDeployTestGate({ deploySucceeded: false, deployErrors: ["boom"] });
    expect(r.passed).toBe(false);
    expect(r.failures.join()).toContain("boom");
  });
});

describe("fidelity gate logic (§4)", () => {
  it("passes a clean report and still requires a human", () => {
    const r = evaluateFidelityGate({ passes: true, violations: [] });
    expect(r.passed).toBe(true);
    expect(r.requiresHuman).toBe(true);
  });

  it("blocks when the prototype over-promises", () => {
    const r = evaluateFidelityGate({
      passes: false,
      violations: [{ element: "custom chart", reason: "Lightning can't match", severity: "high" }],
    });
    expect(r.passed).toBe(false);
  });
});

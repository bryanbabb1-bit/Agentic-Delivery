/**
 * fixtures.ts — recorded agent outputs for the Zennify Client-360 example.
 *
 * One function per subagent, `(input) => output`. Transforming agents
 * (reconciler/builder/qa/handoff) derive from their input so the package stays
 * internally consistent and traceable. These let the FixtureRunner drive the
 * whole Phase-1 pipeline with no live model and no Salesforce org — the proof
 * that the deterministic shell, the gates, and the discovery loop work.
 */
import type {
  SowItem,
  Epic,
  UserStory,
  BuildResult,
  QaResult,
} from "../../driver/contracts.js";
import type { V1 } from "../../driver/v1-reconcile.js";
import type { FixtureMap } from "../../driver/runner.js";

export const fixtures: FixtureMap = {
  parser: (): SowItem[] => [
    {
      id: "SOW-01",
      title: "Client 360 profile in FSC",
      description:
        "Advisors get a unified Person Account profile surfacing financial accounts, goals, and recent activity.",
      bucket: "buildable",
      assumptions: ["Retail clients are modeled as Person Accounts"],
      chainFriendliness: "high",
      flags: [],
    },
  ],

  planner: (input): Epic[] => {
    const items = input as SowItem[];
    return [
      {
        id: "EP-01",
        title: "Client 360",
        sowItemId: items[0]!.id,
        personas: ["Advisor"],
        acceptanceTheme: "An advisor sees a unified client profile in one place",
      },
    ];
  },

  "story-writer": (input): UserStory[] => {
    const epic = input as Epic;
    return [
      {
        id: "US-01.1",
        epicId: epic.id,
        persona: "Advisor",
        asA: "advisor",
        iWant: "a unified client profile",
        soThat: "I can serve clients without hunting across tabs",
        acceptanceCriteria: [
          {
            given: "a Person Account client",
            when: "I open the client profile",
            then: "I see financial accounts, goals, and recent activity together",
          },
        ],
        status: "ready",
        dependencies: [],
        blockingFlags: [],
      },
    ];
  },

  designer: (input) => {
    const stories = input as UserStory[];
    return {
      storyPackages: stories.map((story) => ({
        story,
        solutionDesign: {
          storyId: story.id,
          approach:
            "Standard FSC Lightning profile on the Person Account, composed from native components.",
          automation: "config",
          components: [
            { type: "page_layout", apiName: "Client_360_Profile", action: "create" },
          ],
          testApproach:
            "SIT: open a Person Account and verify the profile renders accounts, goals, and activity.",
        },
      })),
      epicDesigns: [
        {
          id: "DN-01",
          epicId: "EP-01",
          storyIds: stories.map((s) => s.id),
          decisions: [
            {
              question: "How are retail clients modeled?",
              decision: "Person Accounts",
              rationale: "FSC retail default; no custom party model in the SOW.",
            },
          ],
          dataModel: [
            { object: "Account", fields: ["PersonEmail", "PersonHomePhone"], notes: "Person Account" },
            { object: "FinServ__FinancialAccount__c", fields: ["FinServ__Balance__c"] },
          ],
          automation: "config",
          dependencies: [],
          architectApproved: false,
        },
      ],
      assumptions: [
        {
          id: "ASM-01",
          topic: "Account model",
          statement: "Retail clients are modeled as Person Accounts",
          basis: "FSC retail default",
          blocking: true,
          relatedStoryIds: ["US-01.1"],
        },
        {
          id: "ASM-02",
          topic: "Activity source",
          statement: "Recent activity is sourced from standard Task/Event",
          basis: "No core-banking integration named in the SOW",
          blocking: false,
          relatedStoryIds: ["US-01.1"],
        },
      ],
    };
  },

  "proto-layout": () => ({
    screens: [
      {
        name: "Client 360 Profile",
        storyIds: ["US-01.1"],
        objects: ["Account", "FinServ__FinancialAccount__c"],
        interactions: ["open profile", "view goals", "view recent activity"],
      },
    ],
  }),

  "proto-build": () => [
    {
      id: "MOCK-01",
      title: "Client 360 Profile",
      path: "prototypes/client-360-profile.html",
      relatedStoryIds: ["US-01.1"],
      screens: ["Client 360 Profile"],
      fidelityPassed: false,
    },
  ],

  "proto-fidelity": () => ({ passes: true, violations: [] }),

  "proto-walkthrough": () => ({
    scriptPath: "prototypes/zennify-client360-walkthrough.md",
  }),

  reconciler: (input) => {
    const v1 = input as V1;
    return {
      base: { ...v1.package, status: "reconciled" },
      changes: [
        {
          id: "CH-01",
          targetType: "design",
          targetId: "DN-01",
          change: "Confirmed Person Account model; no rework needed.",
          reason: "ASM-01 confirmed in discovery",
        },
      ],
      scopeDeltas: [],
      status: "reconciled",
    };
  },

  builder: (input) => {
    const dn = input as { id: string };
    return {
      designNoteId: dn.id,
      targetOrg: "scratch-demo",
      isProduction: false,
      artifacts: [{ type: "page_layout", apiName: "Client_360_Profile" }],
      deploySucceeded: true,
      deployErrors: [],
    };
  },

  qa: (input) => {
    const build = input as BuildResult;
    return {
      buildRef: build.designNoteId,
      apexCoveragePct: null, // pure-config deliverable
      flowTestsPassed: true,
      sitChecks: [{ name: "Client 360 profile renders", passed: true }],
      contractVerified: true,
      defects: [],
      uatReady: true,
    };
  },

  handoff: (input) => {
    const qa = input as QaResult;
    return {
      epicId: "EP-01",
      sandboxesDeployed: ["fsc-uat-sbx"],
      jiraStoryExport: "https://jira.example/browse/EP-01",
      integrationContracts: [],
      sitResults: `SIT: ${qa.sitChecks.length} check(s) run, uatReady=${qa.uatReady}`,
      knownBoundaries: [
        "Pure-config deliverable — no Apex coverage to report",
        "Recent-activity feed limited to standard Task/Event (no core-banking integration)",
      ],
      knowledgeTransferNotes: "Discovery walkthrough script lives under prototypes/.",
    };
  },
};

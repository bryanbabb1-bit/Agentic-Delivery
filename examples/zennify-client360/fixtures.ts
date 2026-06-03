/**
 * fixtures.ts — recorded agent outputs for the Zennify Client-360 example.
 *
 * One function per subagent, `(input) => output`. Transforming agents
 * (reconciler/builder/qa/handoff) derive from their input so the package stays
 * internally consistent and traceable. These let the FixtureRunner drive the
 * whole Phase-1 pipeline with no live model and no Salesforce org.
 *
 * Prototype HTML is rendered by the driver (not an agent), so these fixtures
 * only supply the structured screen inventory via `proto-layout`.
 */
import type {
  SowItem,
  Epic,
  UserStory,
  BuildResult,
  QaResult,
} from "../../driver/contracts.js";
import type { Assumption } from "../../driver/v1-reconcile.js";
import type { FixtureMap } from "../../driver/runner.js";

/** Shared by the designer register and the proto-layout assumption-bearing screens. */
const ASSUMPTIONS: Assumption[] = [
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
];

export function makeFixtures(): FixtureMap {
  return {
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
        solutionDesigns: stories.map((story) => ({
          storyId: story.id,
          approach:
            "Standard FSC Lightning profile on the Person Account, composed from native components.",
          automation: "config",
          components: [
            { type: "page_layout", apiName: "Client_360_Profile", action: "create" },
          ],
          testApproach:
            "SIT: open a Person Account and verify the profile renders accounts, goals, and activity.",
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
        assumptions: ASSUMPTIONS,
      };
    },

    "proto-layout": () => ({
      screens: [
        {
          name: "Client 360 — Jordan Rivera",
          subtitle: "Person Account · Mass Affluent · Client since 2018 · Advisor: you",
          storyIds: ["US-01.1"],
          objects: ["Account (Person Account)", "FinServ__FinancialAccount__c"],
          highlights: [
            { label: "Total assets", value: "$842,300" },
            { label: "Accounts", value: "3" },
            { label: "Goals on track", value: "1 of 2" },
            { label: "Risk profile", value: "Moderate" },
            { label: "Next review", value: "Jul 2026" },
          ],
          fields: ["Name", "Email", "Phone", "Household", "Segment", "Primary advisor"],
          fieldValues: {
            Name: "Jordan Rivera",
            Email: "jordan.rivera@example.com",
            Phone: "(415) 555-0142",
            Household: "Rivera Household",
            Segment: "Mass Affluent",
            "Primary advisor": "You",
          },
          relatedLists: [
            {
              title: "Financial Accounts",
              columns: ["Account", "Type", "Balance"],
              rows: [
                ["Checking ••4021", "Checking", "$12,500"],
                ["Brokerage ••8830", "Investment", "$615,400"],
                ["IRA ••2275", "Retirement", "$214,400"],
              ],
            },
            {
              title: "Financial Goals",
              columns: ["Goal", "Target", "Progress"],
              rows: [
                ["Retirement", "$2.0M", "31%"],
                ["College fund", "$180,000", "58%"],
              ],
            },
            {
              title: "Recent Activity",
              columns: ["Date", "Activity"],
              rows: [
                ["May 28", "Call — reviewed Q2 portfolio"],
                ["May 14", "Email — sent rebalancing proposal"],
                ["Apr 30", "Meeting — annual financial review"],
              ],
            },
          ],
          interactions: ["open profile", "view goals", "log activity"],
        },
      ],
    }),

    "proto-fidelity": () => ({ passes: true, violations: [] }),

    "proto-walkthrough": () => ({
      scriptPath: "prototypes/zennify-client360-walkthrough.md",
    }),

    reconciler: () => ({
      // Diff only — the orchestrator assembles v2 from the package it holds.
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
    }),

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
}

/** Default (no file writes) — used by the e2e test for a pure in-memory run. */
export const fixtures: FixtureMap = makeFixtures();

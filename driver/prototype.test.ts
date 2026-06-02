/**
 * prototype.test.ts — the HTML/SLDS generator (pure rendering, no I/O).
 */
import { describe, it, expect } from "vitest";
import { renderPrototype, slug, escapeHtml, type RenderOptions } from "./prototype.js";

const opts: RenderOptions = {
  sowRef: "ZEN-SBH-CLIENT360",
  screens: [
    {
      name: "Client 360 Profile",
      storyIds: ["US-01.1"],
      objects: ["Account"],
      fields: ["PersonEmail", "Financial Goals"],
      interactions: ["open profile"],
    },
    {
      name: "Funding & Goals",
      storyIds: ["US-01.2"],
      objects: ["FinServ__FinancialAccount__c"],
      fields: ["FinServ__Balance__c"],
      interactions: [],
    },
  ],
  assumptions: [
    { id: "ASM-01", topic: "Account model", statement: "Person Accounts", blocking: true, relatedStoryIds: ["US-01.1"] },
    { id: "ASM-02", topic: "Activity", statement: "Standard Task/Event", blocking: false, relatedStoryIds: ["US-01.1"] },
  ],
};

describe("slug / escapeHtml", () => {
  it("slugifies screen names", () => {
    expect(slug("Client 360 Profile")).toBe("client-360-profile");
    expect(slug("Funding & Goals")).toBe("funding-goals");
  });

  it("escapes HTML special characters", () => {
    expect(escapeHtml('<script>"&\'')).toBe("&lt;script&gt;&quot;&amp;&#39;");
  });
});

describe("renderPrototype", () => {
  const files = renderPrototype(opts);

  it("emits an index plus one file per screen", () => {
    expect(files.map((f) => f.filename)).toEqual([
      "index.html",
      "client-360-profile.html",
      "funding-goals.html",
    ]);
  });

  it("is self-contained (inline CSS, no external CDN) and renders clickable nav", () => {
    const screen = files.find((f) => f.filename === "client-360-profile.html")!;
    expect(screen.html).toContain("<style>"); // CSS inlined
    expect(screen.html).not.toContain("http://");
    expect(screen.html).not.toContain("https://"); // no network dependency
    expect(screen.html).toContain(".slds-card"); // the inlined stylesheet
    expect(screen.html).toContain('href="funding-goals.html"');
    expect(screen.html).toContain("slds-tabs_default");
  });

  it("renders the assumption panel, flagging blocking assumptions", () => {
    const screen = files.find((f) => f.filename === "client-360-profile.html")!;
    expect(screen.html).toContain("Assumptions in this view");
    expect(screen.html).toContain('data-assumption-id="ASM-01"');
    expect(screen.html).toContain("slds-theme_warning"); // blocking badge
    expect(screen.html).toContain("Confirm");
    expect(screen.html).toContain("Correct");
  });

  it("scopes assumptions to the screen's stories", () => {
    // ASM-01/02 relate to US-01.1, which only the first screen carries.
    const funding = files.find((f) => f.filename === "funding-goals.html")!;
    expect(funding.html).toContain("No open assumptions for this view.");
  });

  it("renders the screen's fields", () => {
    const screen = files.find((f) => f.filename === "client-360-profile.html")!;
    expect(screen.html).toContain("PersonEmail");
    expect(screen.html).toContain("Financial Goals");
  });
});

describe("renderPrototype (rich content)", () => {
  const rich: RenderOptions = {
    sowRef: "DEMO",
    assumptions: [],
    screens: [
      {
        name: "Client 360 — Jordan Rivera",
        subtitle: "Person Account · Mass Affluent",
        storyIds: ["US-01.1"],
        objects: ["Account"],
        fields: ["Name", "Email"],
        fieldValues: { Name: "Jordan Rivera", Email: "jordan.rivera@example.com" },
        highlights: [{ label: "Total assets", value: "$842,300" }],
        relatedLists: [
          { title: "Financial Accounts", columns: ["Account", "Balance"], rows: [["Brokerage ••8830", "$615,400"]] },
        ],
        interactions: [],
      },
    ],
  };

  const html = renderPrototype(rich).find((f) => f.filename === "client-360-jordan-rivera.html")!.html;

  it("shows the subtitle, real field values (not placeholders), and highlights", () => {
    expect(html).toContain("Person Account · Mass Affluent");
    expect(html).toContain("Jordan Rivera");
    expect(html).toContain("jordan.rivera@example.com");
    expect(html).toContain("Total assets");
    expect(html).toContain("$842,300");
  });

  it("renders related-list tables with sample rows", () => {
    expect(html).toContain("Financial Accounts");
    expect(html).toContain("<table class=\"rl\">");
    expect(html).toContain("Brokerage ••8830");
    expect(html).toContain("$615,400");
  });
});

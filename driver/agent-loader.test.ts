/**
 * agent-loader.test.ts — frontmatter parsing, prompt building, JSON extraction,
 * and that every real subagent .md loads with a model + system prompt.
 */
import { describe, it, expect } from "vitest";
import { readdir } from "node:fs/promises";
import {
  parseAgentFile,
  buildUserPrompt,
  extractJson,
  loadAgent,
  defaultAgentsDir,
} from "./agent-loader.js";

describe("parseAgentFile", () => {
  it("parses model and an inline empty tools list", () => {
    const md = `---\nname: parser\nmodel: claude-sonnet-4-6\ntools: []\n---\nYou are the parser.`;
    const def = parseAgentFile("parser", md);
    expect(def.model).toBe("claude-sonnet-4-6");
    expect(def.tools).toEqual([]);
    expect(def.systemPrompt).toBe("You are the parser.");
  });

  it("parses a YAML list of tools", () => {
    const md = `---\nname: handoff\nmodel: claude-haiku-4-5-20251001\ntools:\n  - mcp__jira\n  - Write\n---\nYou assemble the handoff.`;
    const def = parseAgentFile("handoff", md);
    expect(def.tools).toEqual(["mcp__jira", "Write"]);
    expect(def.model).toBe("claude-haiku-4-5-20251001");
  });
});

describe("buildUserPrompt", () => {
  it("passes a string input through as plain text", () => {
    const p = buildUserPrompt("SOW scope text");
    expect(p).toContain("SOW scope text");
    expect(p).toContain("Return ONLY the JSON");
  });

  it("serializes object input as a JSON block", () => {
    const p = buildUserPrompt({ id: "EP-01" });
    expect(p).toContain('"id": "EP-01"');
  });
});

describe("extractJson", () => {
  it("parses bare JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("strips ```json fences", () => {
    expect(extractJson("```json\n[1,2,3]\n```")).toEqual([1, 2, 3]);
  });
  it("recovers JSON surrounded by prose", () => {
    expect(extractJson('Here you go: {"ok":true} — done')).toEqual({ ok: true });
  });
  it("takes the first complete value when trailing content follows", () => {
    // The reconciler sometimes emits a second object / closing remark after the JSON.
    expect(extractJson('{"changes":[]}\n{"note":"done"}')).toEqual({ changes: [] });
    expect(extractJson('[]\nthat is all')).toEqual([]);
  });
  it("ignores braces inside string values when scanning", () => {
    expect(extractJson('{"a":"a } b","b":1} trailing')).toEqual({ a: "a } b", b: 1 });
  });
  it("throws when there is no JSON", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("real subagent definitions", () => {
  it("every .claude/agents/*.md loads with a model and a non-empty prompt", async () => {
    const dir = defaultAgentsDir();
    const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(12);
    for (const file of files) {
      const def = await loadAgent(file.replace(/\.md$/, ""), dir);
      expect(def.model, `${file} model`).toBeTruthy();
      expect(def.systemPrompt.length, `${file} prompt`).toBeGreaterThan(20);
    }
  });
});

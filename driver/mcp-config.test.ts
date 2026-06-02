/**
 * mcp-config.test.ts — sanitizing .mcp.json and resolving MCP server names.
 */
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { sanitizeMcpServers, mcpServerName, loadMcpServers, defaultMcpConfigPath } from "./mcp-config.js";

describe("sanitizeMcpServers", () => {
  it("drops `//` comment keys and keeps stdio configs", () => {
    const raw = {
      "//": "a top-level comment",
      mcpServers: {
        "//": "another comment",
        "salesforce-dx": { "//": "note", command: "npx", args: ["-y", "@salesforce/mcp"], env: { A: "1" } },
        jira: { command: "npx", args: ["-y", "@atlassian/mcp-server-jira"] },
      },
    };
    const out = sanitizeMcpServers(raw);
    expect(Object.keys(out).sort()).toEqual(["jira", "salesforce-dx"]);
    expect(out["salesforce-dx"]).toEqual({ command: "npx", args: ["-y", "@salesforce/mcp"], env: { A: "1" } });
    expect(Object.keys(out["salesforce-dx"]!)).not.toContain("//");
  });

  it("skips entries without a string command", () => {
    const out = sanitizeMcpServers({ mcpServers: { broken: { args: ["x"] } } });
    expect(out).toEqual({});
  });

  it("returns empty for malformed input", () => {
    expect(sanitizeMcpServers(null)).toEqual({});
    expect(sanitizeMcpServers({})).toEqual({});
  });
});

describe("mcpServerName", () => {
  it("extracts the server from an mcp__ tool grant", () => {
    expect(mcpServerName("mcp__salesforce-dx")).toBe("salesforce-dx");
    expect(mcpServerName("mcp__jira")).toBe("jira");
    expect(mcpServerName("mcp__salesforce-dx__deploy")).toBe("salesforce-dx");
  });
  it("returns undefined for non-mcp tools", () => {
    expect(mcpServerName("Write")).toBeUndefined();
  });
});

describe("the repo .mcp.json", () => {
  it("sanitizes to the two expected servers", async () => {
    const servers = await loadMcpServers();
    expect(Object.keys(servers).sort()).toEqual(["jira", "salesforce-dx"]);
    // sanity: the file on disk does carry comment keys that must have been stripped.
    const raw = await readFile(defaultMcpConfigPath(), "utf8");
    expect(raw).toContain('"//"');
  });
});

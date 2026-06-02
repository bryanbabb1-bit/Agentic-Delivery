/**
 * mcp-config.ts — load + sanitize MCP server configs from .mcp.json.
 *
 * .mcp.json carries human `"//"` comment keys (both top-level and inside each
 * server) that are NOT valid server configs. This strips them and normalizes to
 * the stdio shape the Agent SDK expects, so SdkRunner can grant the right MCP
 * servers to the agents that declare them.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface StdioMcpServer {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type McpServerMap = Record<string, StdioMcpServer>;

export function defaultMcpConfigPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", ".mcp.json");
}

/** Drop `"//"` comment keys and keep only well-formed stdio server configs. */
export function sanitizeMcpServers(raw: unknown): McpServerMap {
  const out: McpServerMap = {};
  const servers = (raw as { mcpServers?: unknown })?.mcpServers;
  if (!servers || typeof servers !== "object") return out;

  for (const [name, value] of Object.entries(servers as Record<string, unknown>)) {
    if (name.startsWith("//") || !value || typeof value !== "object") continue;
    const cfg = value as Record<string, unknown>;
    if (typeof cfg.command !== "string") continue;

    const server: StdioMcpServer = { command: cfg.command };
    if (Array.isArray(cfg.args)) {
      server.args = cfg.args.filter((a): a is string => typeof a === "string");
    }
    if (cfg.env && typeof cfg.env === "object") {
      server.env = Object.fromEntries(
        Object.entries(cfg.env as Record<string, unknown>).filter(
          (e): e is [string, string] => typeof e[1] === "string",
        ),
      );
    }
    out[name] = server;
  }
  return out;
}

export async function loadMcpServers(path = defaultMcpConfigPath()): Promise<McpServerMap> {
  return sanitizeMcpServers(JSON.parse(await readFile(path, "utf8")));
}

/** The server name an MCP tool grant refers to: `mcp__salesforce-dx` → `salesforce-dx`. */
export function mcpServerName(tool: string): string | undefined {
  if (!tool.startsWith("mcp__")) return undefined;
  return tool.slice("mcp__".length).split("__")[0];
}

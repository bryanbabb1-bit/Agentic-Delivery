/**
 * agent-loader.ts — read a subagent's .md definition and parse model output.
 *
 * Pure helpers (frontmatter parse, JSON extraction, prompt building) plus a thin
 * fs loader. Used by SdkRunner to turn `.claude/agents/<name>.md` into a live
 * Agent SDK call and to recover the JSON the agent emits.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface AgentDef {
  name: string;
  model?: string;
  tools: string[];
  systemPrompt: string;
}

/** Default location of the subagent definitions, relative to this file. */
export function defaultAgentsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", ".claude", "agents");
}

/**
 * Parse a subagent markdown file: YAML-ish frontmatter (name/model/tools) plus
 * the system-prompt body. Intentionally small — we control these files, so a
 * full YAML parser is overkill.
 */
export function parseAgentFile(name: string, content: string): AgentDef {
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  const frontmatter = fm ? fm[1]! : "";
  const body = (fm ? fm[2]! : content).trim();

  const model = frontmatter.match(/^model:\s*(.+?)\s*$/m)?.[1];

  // tools: either inline (`tools: [a, b]` / `tools: a, b`) or a YAML list of
  // `  - item` lines following a `tools:` key.
  const tools: string[] = [];
  const inline = frontmatter.match(/^tools:[ \t]*(.*)$/m)?.[1]?.trim();
  if (inline && inline !== "[]") {
    for (const t of inline.replace(/^\[|\]$/g, "").split(",")) {
      const v = t.trim();
      if (v) tools.push(v);
    }
  } else if (!inline) {
    const listBlock = frontmatter.match(/^tools:\s*\n((?:\s*-\s*.+\n?)+)/m)?.[1] ?? "";
    for (const line of listBlock.split("\n")) {
      const v = line.replace(/^\s*-\s*/, "").trim();
      if (v) tools.push(v);
    }
  }

  return { name, model, tools, systemPrompt: body };
}

export async function loadAgent(name: string, agentsDir = defaultAgentsDir()): Promise<AgentDef> {
  const content = await readFile(join(agentsDir, `${name}.md`), "utf8");
  return parseAgentFile(name, content);
}

/** Serialize a stage input into the user prompt the agent receives. */
export function buildUserPrompt(input: unknown): string {
  const payload =
    typeof input === "string"
      ? input
      : "```json\n" + JSON.stringify(input, null, 2) + "\n```";
  return `${typeof input === "string" ? "Input:" : "Input (JSON):"}\n\n${payload}\n\nReturn ONLY the JSON output for this stage — no prose, no code fences.`;
}

/**
 * Scan from the first `{`/`[` and return the first COMPLETE, depth-balanced JSON
 * value, ignoring any trailing content (a second object, a closing remark, etc.).
 * String-aware so braces inside string literals don't throw off the depth count.
 */
function firstJsonValue(t: string): string | null {
  const a = t.indexOf("{");
  const b = t.indexOf("[");
  const start = a < 0 ? b : b < 0 ? a : Math.min(a, b);
  if (start < 0) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      if (--depth === 0) return t.slice(start, i + 1);
    }
  }
  return null; // unbalanced — no complete value
}

/**
 * Recover the JSON an agent emitted. Tolerates code fences and surrounding prose:
 * tries a direct parse, then extracts the first complete top-level JSON value
 * (robust to trailing content the model appended after it).
 */
export function extractJson(text: string): unknown {
  let t = text.trim();

  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1]!.trim();

  try {
    return JSON.parse(t);
  } catch {
    /* fall through to balanced-scan extraction */
  }

  const candidate = firstJsonValue(t);
  if (candidate) return JSON.parse(candidate);

  throw new Error(`Could not extract JSON from agent output: ${text.slice(0, 200)}…`);
}

#!/usr/bin/env -S npx tsx
/**
 * submit.ts — the front door.
 *
 * The ONLY team-facing surface. A delivery-team member drops a signed SOW here
 * and receives a DeliverablePackage; they never see, operate, or manage an
 * agent. SOW in, package out — compiler, not copilot (ARCHITECTURE.md §7).
 *
 *   npm run intake -- <path/to/sow.txt> [--ref SOW-REF] [--out deliverable.json]
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { run, runPlanPhase } from "../driver/orchestrator.js";
import {
  AutoConfirmDiscovery,
  AutoApproveHumanGate,
  SdkRunner,
  ConsoleProgress,
} from "../driver/runner.js";

const HELP = `sow-to-ship intake — submit a SOW, receive a deliverable package.

Usage:
  npm run intake -- <sow-file> [options]

Options:
  --ref <id>     SOW reference id (default: derived from the filename)
  --out <file>   where to write the DeliverablePackage JSON (default: stdout)
  --prototypes <dir>  where to render the clickable prototype (default: prototypes/<ref>)
  --plan-only    run only the front half (parse → … → reconcile + prototype);
                 no Salesforce org / DX MCP required
  --auto         auto-confirm discovery + auto-approve human gates (unattended
                 run; demo/testing only — real engagements keep humans in these loops)
  -h, --help     show this help

By default the live SDK runner is used (set ANTHROPIC_API_KEY). The pipeline
pauses at the discovery loop and the human gates unless --auto is passed.`;

interface Args {
  sowFile?: string;
  ref?: string;
  out?: string;
  prototypes?: string;
  auto: boolean;
  planOnly: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { help: false, auto: false, planOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") args.help = true;
    else if (a === "--auto") args.auto = true;
    else if (a === "--plan-only") args.planOnly = true;
    else if (a === "--ref") args.ref = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--prototypes") args.prototypes = argv[++i];
    else if (a && !a.startsWith("-")) args.sowFile ??= a;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.sowFile) {
    console.log(HELP);
    process.exit(args.help ? 0 : 1);
  }

  const sowText = await readFile(args.sowFile, "utf8");
  const sowRef = args.ref ?? basename(args.sowFile).replace(/\.[^.]+$/, "");

  const deps: Record<string, unknown> = args.auto
    ? { discovery: new AutoConfirmDiscovery(), humanGate: new AutoApproveHumanGate() }
    : {};
  // Live per-agent progress to stderr (stdout stays clean for the JSON package).
  deps.progress = new ConsoleProgress();
  // The front half needs no Salesforce org, so run it with MCP disabled — the
  // designer grounds from the SOW + fsc-patterns skill instead of a live org.
  if (args.planOnly) deps.runner = new SdkRunner({ disableMcp: true });

  // Render the clickable prototype into ./prototypes/<sowRef>/ (override with --prototypes).
  const protoDir = args.prototypes ?? join("prototypes", sowRef);
  const runInput = { sowRef, sowText, prototypeOut: { dir: protoDir } };

  const result = args.planOnly
    ? await runPlanPhase(runInput, deps)
    : await run(runInput, deps);
  const json = JSON.stringify(result.deliverable, null, 2);

  if (args.out) {
    await writeFile(args.out, json, "utf8");
    console.log(`Deliverable package written to ${args.out}`);
  } else {
    console.log(json);
  }
  console.log(`Prototype rendered to ${join(protoDir, "index.html")}`);
}

main().catch((err) => {
  console.error(`intake failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

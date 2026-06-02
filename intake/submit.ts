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
import { basename } from "node:path";
import { run } from "../driver/orchestrator.js";

const HELP = `sow-to-ship intake — submit a SOW, receive a deliverable package.

Usage:
  npm run intake -- <sow-file> [options]

Options:
  --ref <id>     SOW reference id (default: derived from the filename)
  --out <file>   where to write the DeliverablePackage JSON (default: stdout)
  -h, --help     show this help

The agents, orchestration, and gates run out of sight. To iterate, resubmit with
corrected assumptions through this same surface.`;

interface Args {
  sowFile?: string;
  ref?: string;
  out?: string;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") args.help = true;
    else if (a === "--ref") args.ref = argv[++i];
    else if (a === "--out") args.out = argv[++i];
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

  const result = await run({ sowRef, sowText });
  const json = JSON.stringify(result.deliverable, null, 2);

  if (args.out) {
    await writeFile(args.out, json, "utf8");
    console.log(`Deliverable package written to ${args.out}`);
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error(`intake failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

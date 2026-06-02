/**
 * intake-service.test.ts — the web front door's engine, without sockets.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runIntake } from "./intake-service.js";

const SOW = "Client 360 in FSC — unified Person Account profile for advisors.";
const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "intake-"));
  dirs.push(d);
  return d;
}

describe("runIntake", () => {
  it("produces a package, assumptions, and rendered prototype files", async () => {
    const runsRoot = await tempRoot();
    const out = await runIntake({ sowText: SOW, sowRef: "TEST-01", runsRoot });

    expect(out.mode).toBe("demo");
    expect(out.sowRef).toBe("TEST-01");
    expect(out.result.deliverable.status).toBe("reconciled");
    expect(out.result.assumptions.length).toBeGreaterThan(0);

    // Prototype files were written and the index sorts first.
    expect(out.prototypes.length).toBeGreaterThan(0);
    expect(out.prototypes[0]!.file).toBe("index.html");

    // The served file exists and is self-contained HTML.
    const html = await readFile(join(runsRoot, out.runId, out.prototypes[0]!.file), "utf8");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("derives a SOW ref when none is given", async () => {
    const runsRoot = await tempRoot();
    const out = await runIntake({ sowText: SOW, runsRoot });
    expect(out.sowRef).toMatch(/^INTAKE-/);
  });

  it("rejects empty SOW text", async () => {
    const runsRoot = await tempRoot();
    await expect(runIntake({ sowText: "   ", runsRoot })).rejects.toThrow(/empty/);
  });
});

/**
 * extract.ts — turn an uploaded SOW file (PDF / Word / text) into clean text.
 *
 * The binary extraction is delegated to `extract.py` (pypdf for PDF, stdlib for
 * .docx); this module normalizes the result — ligatures, smart punctuation, PDF
 * one-word-per-line noise, and common SOW boilerplate — into parser-ready text.
 */
import { spawn } from "node:child_process";
import { writeFile, unlink, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, "extract.py");
const PYTHON = process.env.PYTHON ?? "python";

const LIGATURES: [RegExp, string][] = [
  [/ﬀ/g, "ff"], [/ﬁ/g, "fi"], [/ﬂ/g, "fl"], [/ﬃ/g, "ffi"], [/ﬄ/g, "ffl"],
  [/[“”]/g, '"'], [/[‘’]/g, "'"],
  [/[–—]/g, "-"], [/…/g, "..."], [/ /g, " "], [/﻿/g, ""],
  [/[●○•]/g, " - "],
];

/** Normalize extracted text into clean, parser-ready SOW prose. */
export function cleanSowText(raw: string): string {
  let t = raw;
  for (const [pat, rep] of LIGATURES) t = t.replace(pat, rep);
  // Drop common SOW boilerplate that adds noise without scope.
  t = t.replace(/Docusign Envelope ID:[^\n]*/gi, " ");
  t = t.replace(/Notice of Confidentiality[\s\S]*?All rights reserved\.?/gi, " ");
  // Collapse all whitespace (fixes PDF one-word-per-line), then restore breaks
  // before numbered section headers so the structure stays legible.
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/\s(\d{1,2}\.\s+[A-Z][a-z])/g, "\n\n$1");
  return t.trim() + "\n";
}

function runPython(script: string, file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, [script, file]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on("data", (d: Buffer) => out.push(d));
    proc.stderr.on("data", (d: Buffer) => err.push(d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString("utf8"));
      else reject(new Error(Buffer.concat(err).toString("utf8").trim() || `extract.py exited ${code}`));
    });
  });
}

/** Extract clean text from an uploaded file buffer (dispatched by extension). */
export async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const ext = (extname(filename) || ".txt").toLowerCase();
  const dir = await mkdtemp(join(tmpdir(), "sow-"));
  const tmp = join(dir, `upload${ext}`);
  await writeFile(tmp, buffer);
  try {
    const raw = await runPython(SCRIPT, tmp);
    return cleanSowText(raw);
  } finally {
    await unlink(tmp).catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

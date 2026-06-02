#!/usr/bin/env node
/**
 * screenshot.mjs — render the generated prototypes to PNGs for visual QA.
 *
 * This is the "QA myself" tool: it drives a headless browser over every
 * prototypes/*.html and writes a PNG next to it, so the rendered result can be
 * eyeballed (by a human or an agent) instead of trusted blind.
 *
 *   npm run qa:screenshot
 *
 * Requires a Chromium that Playwright can launch:
 *   npx playwright install chromium
 * (Note: some sandboxed environments block the browser-binary download — in that
 * case run this on a machine/CI that allows it.)
 */
import { readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const protoDir = join(here, "..", "prototypes");

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("Playwright is not installed. Run: npm i -D playwright");
    process.exit(1);
  }

  const files = (await readdir(protoDir)).filter((f) => f.endsWith(".html"));
  if (files.length === 0) {
    console.error("No prototypes found. Run `npm run example` first.");
    process.exit(1);
  }

  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    console.error(`Could not launch Chromium: ${err.message}`);
    console.error("Install the browser binary with: npx playwright install chromium");
    process.exit(1);
  }

  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  for (const file of files) {
    const out = join(protoDir, file.replace(/\.html$/, ".png"));
    await page.goto(pathToFileURL(join(protoDir, file)).href, { waitUntil: "load" });
    await page.screenshot({ path: out, fullPage: true });
    console.log(`rendered ${file} -> ${out}`);
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env -S npx tsx
/**
 * server.ts — the intake web front door.
 *
 * A dependency-free Node HTTP server over the pipeline. Routes:
 *   GET  /                     → the intake page
 *   GET  /api/example          → the bundled sample SOW text
 *   POST /api/intake           → run the pipeline, return package + prototypes
 *   GET  /runs/<id>/<file>     → serve a generated prototype (sandboxed to runs)
 *
 *   npm run web        # then open http://localhost:4317
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { runIntake } from "./intake-service.js";

const here = dirname(fileURLToPath(import.meta.url));
const runsRoot = join(here, ".runs");
const PORT = Number(process.env.PORT ?? 4317);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};

function send(res: import("node:http").ServerResponse, status: number, body: string | Buffer, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Serve a file from runsRoot, rejecting any path that escapes it. */
async function serveRunFile(res: import("node:http").ServerResponse, urlPath: string) {
  const rel = normalize(decodeURIComponent(urlPath.replace(/^\/runs\//, "")));
  const full = resolve(runsRoot, rel);
  if (full !== runsRoot && !full.startsWith(runsRoot + sep)) {
    return send(res, 403, "Forbidden");
  }
  try {
    const ext = full.slice(full.lastIndexOf("."));
    const data = await readFile(full);
    send(res, 200, data, CONTENT_TYPES[ext] ?? "application/octet-stream");
  } catch {
    send(res, 404, "Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    if (req.method === "GET" && url.pathname === "/") {
      const html = await readFile(join(here, "index.html"));
      return send(res, 200, html, CONTENT_TYPES[".html"]);
    }

    if (req.method === "GET" && url.pathname === "/api/example") {
      const sow = await readFile(join(here, "..", "examples", "zennify-client360", "sow.txt"), "utf8");
      return send(res, 200, JSON.stringify({ sowText: sow, sowRef: "ZEN-SBH-CLIENT360" }), "application/json");
    }

    if (req.method === "POST" && url.pathname === "/api/intake") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const out = await runIntake({ sowText: String(body.sowText ?? ""), sowRef: body.sowRef, runsRoot });
      return send(res, 200, JSON.stringify(out), "application/json");
    }

    if (req.method === "GET" && url.pathname.startsWith("/runs/")) {
      return serveRunFile(res, url.pathname);
    }

    send(res, 404, "Not found");
  } catch (err) {
    send(res, 500, JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), "application/json");
  }
});

server.listen(PORT, () => {
  console.log(`SOW → Ship intake running at http://localhost:${PORT}  (demo mode — fixtures)`);
});

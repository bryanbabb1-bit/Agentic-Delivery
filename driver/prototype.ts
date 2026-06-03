/**
 * prototype.ts — authentic Lightning (SLDS) record-page prototype generator.
 *
 * Renders each screen as a believable Salesforce Lightning record page: a
 * highlights panel (object icon, record name, key fields, actions), record tabs,
 * a two-column Details region, related-list cards, and an Activity panel — styled
 * in real SLDS colors (Lightning blue, gray canvas, SLDS borders). Field labels
 * are shown the way a user sees them (friendly, not API names).
 *
 * The assumption register lives in an OFF-CANVAS drawer (a floating button opens
 * it) so the page reflects the true UI a user would work in — not a schema dump
 * with a panel bolted on. Pure inline CSS/JS: renders fully offline, no CDN.
 *
 * Pure rendering (no I/O) so it's unit-testable, plus a thin `writePrototype`
 * helper for the file-writing side effect.
 */
import { mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

/** A display cell from the layout agent — may arrive as a string, number, or null. */
export type Cell = string | number | boolean | null | undefined;

export interface PrototypeRelatedList {
  title: string;
  columns: string[];
  rows: Cell[][];
}

export interface PrototypeScreen {
  name: string;
  /** Context line under the title, e.g. the client and segment. */
  subtitle?: string;
  storyIds: string[];
  /** Backing objects — shown as a small data-source note, not the headline. */
  objects: string[];
  /** Friendly object label for the header chip (e.g. "Person Account"). */
  objectLabel?: string;
  /** Record-detail field labels (shown as a user sees them). */
  fields: string[];
  /** Sample values per field label (so the page reads as real data, not "—"). */
  fieldValues?: Record<string, Cell>;
  /** Key facts shown in the highlights panel under the record name. */
  highlights?: { label: string; value: Cell }[];
  /** Header action buttons (Edit, New Case, …). */
  actions?: string[];
  /** Related-list tables (financial accounts, goals, activity, …). */
  relatedLists?: PrototypeRelatedList[];
  interactions: string[];
}

export interface PrototypeAssumption {
  id: string;
  topic: string;
  statement: string;
  blocking: boolean;
  relatedStoryIds: string[];
}

export interface PrototypeFile {
  filename: string;
  title: string;
  html: string;
}

export interface RenderOptions {
  sowRef: string;
  screens: PrototypeScreen[];
  assumptions: PrototypeAssumption[];
}

/**
 * Authentic-ish SLDS stylesheet: Lightning blue brand, gray canvas, SLDS borders
 * and type scale. Inlined into every page so prototypes render fully offline.
 */
const BASE_CSS = `
  :root {
    --brand:#1589ee; --brand-dark:#0176d3; --brand-deep:#032d60;
    --canvas:#f3f3f3; --border:#dddbda; --line:#ebeae8;
    --text:#080707; --label:#3e3e3c; --weak:#706e6b; --warn:#fe9339; --success:#2e844a;
  }
  * { box-sizing:border-box; }
  body { margin:0; font-family:'Salesforce Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:var(--text); background:var(--canvas); font-size:13px; }
  a { color:var(--brand-dark); text-decoration:none; } a:hover { text-decoration:underline; }
  .proto-banner { background:#faffbd; border-bottom:1px solid #e4e466; padding:.3rem .75rem; text-align:center; font-size:.72rem; color:#514f4d; }

  /* Global nav (app + screen switcher) */
  .nav { background:#fff; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:.5rem; padding:0 .75rem; box-shadow:0 2px 2px rgba(0,0,0,.05); }
  .nav .app { font-weight:700; color:var(--brand-deep); padding:.65rem .5rem; font-size:.95rem; display:flex; align-items:center; gap:.4rem; }
  .nav .app .sq { width:1.3rem; height:1.3rem; border-radius:.2rem; background:var(--brand); display:inline-block; }
  .slds-tabs_default__nav { display:flex; gap:0; list-style:none; margin:0; padding:0; overflow-x:auto; }
  .slds-tabs_default__item { }
  .slds-tabs_default__link { display:inline-block; padding:.7rem .85rem; color:var(--weak); border-bottom:3px solid transparent; white-space:nowrap; font-size:.82rem; }
  .slds-tabs_default__item.slds-is-active .slds-tabs_default__link { color:var(--brand-dark); border-bottom-color:var(--brand); font-weight:600; }

  .page { max-width:1140px; margin:0 auto; padding:.75rem; }

  /* Highlights panel (record header) */
  .hl { background:#fff; border:1px solid var(--border); border-radius:.25rem; padding:.85rem 1rem; margin-bottom:.75rem; box-shadow:0 2px 2px rgba(0,0,0,.05); }
  .hl-top { display:flex; align-items:center; gap:.75rem; }
  .hl-icon { width:2.5rem; height:2.5rem; border-radius:.35rem; display:flex; align-items:center; justify-content:center; color:#fff; font-size:1.2rem; flex:0 0 auto; }
  .hl-meta { flex:1 1 auto; min-width:0; }
  .hl-eyebrow { font-size:.72rem; color:var(--weak); text-transform:uppercase; letter-spacing:.04em; }
  .hl-title { font-size:1.3rem; font-weight:700; margin:.05rem 0 0; line-height:1.2; }
  .hl-actions { display:flex; gap:.4rem; flex-wrap:wrap; }
  .btn { display:inline-block; padding:.32rem .75rem; border-radius:.25rem; border:1px solid var(--border); background:#fff; color:var(--brand-dark); font-size:.8rem; cursor:pointer; font:inherit; line-height:1.5; }
  .btn:hover { background:#f4f6f9; }
  .btn-brand { background:var(--brand-dark); border-color:var(--brand-dark); color:#fff; }
  .btn-brand:hover { background:#014486; }
  .hl-fields { display:flex; gap:1.5rem; flex-wrap:wrap; margin-top:.75rem; padding-top:.6rem; border-top:1px solid var(--line); }
  .hl-field .k { font-size:.7rem; color:var(--weak); text-transform:uppercase; letter-spacing:.03em; }
  .hl-field .v { font-size:.95rem; font-weight:700; margin-top:.1rem; }

  /* Record tabs */
  .rtabs { display:flex; gap:0; background:#fff; border:1px solid var(--border); border-bottom:0; border-radius:.25rem .25rem 0 0; padding:0 .5rem; }
  .rtab { padding:.6rem .8rem; font-size:.82rem; color:var(--weak); border-bottom:3px solid transparent; }
  .rtab.active { color:var(--brand-dark); border-bottom-color:var(--brand); font-weight:600; }
  .rwrap { display:grid; grid-template-columns: 2fr 1fr; gap:.75rem; }
  @media (max-width:720px){ .rwrap { grid-template-columns:1fr; } }

  .slds-card { background:#fff; border:1px solid var(--border); border-radius:.25rem; margin-bottom:.75rem; box-shadow:0 2px 2px rgba(0,0,0,.05); }
  .card-hd { padding:.6rem .9rem; border-bottom:1px solid var(--line); font-weight:700; font-size:.85rem; display:flex; align-items:center; gap:.4rem; }
  .card-bd { padding:.75rem .9rem; }
  .card-ft { padding:.5rem .9rem; border-top:1px solid var(--line); color:var(--weak); font-size:.78rem; }

  /* Details two-column field grid */
  .fgrid { display:grid; grid-template-columns:1fr 1fr; gap:.1rem 2rem; }
  @media (max-width:560px){ .fgrid { grid-template-columns:1fr; } }
  .fitem { padding:.4rem 0; border-bottom:1px solid var(--line); }
  .fitem .k { font-size:.72rem; color:var(--weak); margin-bottom:.1rem; }
  .fitem .v { font-size:.86rem; color:var(--text); }
  .fitem .v.empty { color:#b0adab; }
  .fitem .v a { color:var(--brand-dark); }

  /* Related list table */
  table.rl { width:100%; border-collapse:collapse; font-size:.82rem; }
  table.rl th { text-align:left; color:var(--weak); font-weight:600; font-size:.7rem; text-transform:uppercase; letter-spacing:.03em; border-bottom:1px solid var(--line); padding:.4rem .5rem; }
  table.rl td { padding:.45rem .5rem; border-bottom:1px solid var(--line); }
  table.rl tr:hover td { background:#f4f6f9; }
  table.rl td:first-child { color:var(--brand-dark); }
  .data-source { color:var(--weak); font-size:.72rem; margin:.25rem 0 .5rem; }

  /* Off-canvas assumptions drawer (hidden by default) */
  .asm-toggle { position:absolute; left:-9999px; }
  .asm-fab { position:fixed; right:1rem; bottom:1rem; z-index:30; background:var(--brand-dark); color:#fff; border-radius:2rem; padding:.55rem .95rem; font-size:.82rem; font-weight:600; cursor:pointer; box-shadow:0 4px 12px rgba(0,0,0,.25); }
  .asm-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.25); opacity:0; visibility:hidden; transition:opacity .15s; z-index:31; }
  .asm-drawer { position:fixed; top:0; right:0; height:100%; width:360px; max-width:88vw; background:#fff; box-shadow:-4px 0 16px rgba(0,0,0,.2); transform:translateX(100%); transition:transform .2s ease; z-index:32; display:flex; flex-direction:column; }
  .asm-toggle:checked ~ .asm-backdrop { opacity:1; visibility:visible; }
  .asm-toggle:checked ~ .asm-drawer { transform:translateX(0); }
  .asm-hd { padding:.85rem 1rem; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; }
  .asm-hd h2 { font-size:.95rem; margin:0; }
  .asm-x { cursor:pointer; color:var(--weak); font-size:1.2rem; line-height:1; }
  .asm-list { padding:.75rem 1rem; overflow:auto; }
  .asm { border:1px solid var(--border); border-left:3px solid var(--brand); border-radius:.25rem; padding:.6rem; margin-bottom:.6rem; }
  .asm.blocking { border-left-color:var(--warn); }
  .asm-row { display:flex; justify-content:space-between; align-items:center; margin-bottom:.25rem; gap:.5rem; }
  .asm-topic { font-size:.72rem; text-transform:uppercase; letter-spacing:.03em; color:var(--weak); font-weight:700; }
  .badge { font-size:.62rem; text-transform:uppercase; border-radius:.25rem; padding:.08rem .4rem; background:#ecebea; color:#514f4d; white-space:nowrap; }
  .badge.warn { background:var(--warn); color:#2b2826; }
  .asm-stmt { font-size:.82rem; margin:.15rem 0 .5rem; }
  .asm-btns { display:flex; gap:.4rem; }
  .asm-empty { color:var(--weak); font-size:.85rem; }
`;

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render a field/label the way a user sees it in Lightning — strip the managed
 * namespace, the `__c`/`__r` suffix, underscores, and split camelCase. A safety
 * net so even an API name the agent slipped in reads as a friendly label.
 */
export function prettyLabel(raw: string): string {
  let s = String(raw).trim();
  s = s.replace(/^[A-Za-z0-9]+__/, ""); // drop managed prefix e.g. FinServ__
  s = s.replace(/__(c|r|pc|pr)$/i, ""); // drop custom suffix
  s = s.replace(/_/g, " ");
  s = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2"); // split camelCase
  s = s.replace(/\bId\b/g, "ID").replace(/\s+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A stable color + glyph for the record's object icon (evokes the SLDS entity icon). */
function objectIcon(screen: PrototypeScreen): { color: string; glyph: string } {
  const hint = `${screen.objectLabel ?? ""} ${screen.objects.join(" ")} ${screen.name}`.toLowerCase();
  if (hint.includes("person") || hint.includes("contact") || hint.includes("client") || hint.includes("household"))
    return { color: "#e9573e", glyph: "\u{1F464}" }; // person
  if (hint.includes("financial account") || hint.includes("portfolio") || hint.includes("account"))
    return { color: "#0d9dda", glyph: "\u{1F3E6}" }; // bank
  if (hint.includes("goal")) return { color: "#4bc076", glyph: "\u{1F3AF}" };
  if (hint.includes("action plan") || hint.includes("task")) return { color: "#9050e9", glyph: "✓" };
  if (hint.includes("opportunity") || hint.includes("onboard")) return { color: "#fcb95b", glyph: "\u{1F4B0}" };
  if (hint.includes("flow") || hint.includes("rollup") || hint.includes("config") || hint.includes("permission"))
    return { color: "#5867e8", glyph: "⚙" };
  return { color: "#1589ee", glyph: "◆" };
}

function cellText(v: Cell): string {
  return v === null || v === undefined || v === "" ? "" : String(v);
}

/** Assumptions relevant to a screen: those sharing a story, or global if unscoped. */
function assumptionsForScreen(
  screen: PrototypeScreen,
  assumptions: PrototypeAssumption[],
): PrototypeAssumption[] {
  return assumptions.filter(
    (a) =>
      a.relatedStoryIds.length === 0 ||
      a.relatedStoryIds.some((id) => screen.storyIds.includes(id)),
  );
}

function renderNav(screens: PrototypeScreen[], activeFilename: string, sowRef: string): string {
  const tabs = screens
    .map((s) => {
      const file = `${slug(s.name)}.html`;
      const active = file === activeFilename;
      return `        <li class="slds-tabs_default__item${active ? " slds-is-active" : ""}" role="presentation"><a class="slds-tabs_default__link" href="${file}" role="tab" aria-selected="${active}">${escapeHtml(s.name)}</a></li>`;
    })
    .join("\n");
  return `  <div class="nav">
    <span class="app"><span class="sq"></span>${escapeHtml(sowRef)}</span>
    <div class="slds-tabs_default" style="flex:1;min-width:0;">
      <ul class="slds-tabs_default__nav" role="tablist">
${tabs}
      </ul>
    </div>
  </div>`;
}

function renderHeader(screen: PrototypeScreen): string {
  const { color, glyph } = objectIcon(screen);
  const objLabel = screen.objectLabel ?? (screen.objects[0] ? prettyLabel(screen.objects[0]) : "Record");
  const actions = (screen.actions && screen.actions.length ? screen.actions : ["Edit"]).slice(0, 4);
  const actionBtns = actions
    .map((a, i) => `<button class="btn${i === 0 ? " btn-brand" : ""}" type="button">${escapeHtml(a)}</button>`)
    .join("");
  const hlFields = (screen.highlights ?? [])
    .filter((h) => cellText(h.value) !== "")
    .map((h) => `<div class="hl-field"><div class="k">${escapeHtml(prettyLabel(h.label))}</div><div class="v">${escapeHtml(cellText(h.value))}</div></div>`)
    .join("");
  return `  <div class="hl">
    <div class="hl-top">
      <div class="hl-icon" style="background:${color}">${glyph}</div>
      <div class="hl-meta">
        <div class="hl-eyebrow">${escapeHtml(objLabel)}</div>
        <h1 class="hl-title">${escapeHtml(screen.name)}</h1>
      </div>
      <div class="hl-actions">${actionBtns}</div>
    </div>
${hlFields ? `    <div class="hl-fields">${hlFields}</div>` : ""}
  </div>`;
}

function renderDetails(screen: PrototypeScreen): string {
  if (screen.fields.length === 0) {
    return `<p class="asm-empty">No fields specified for this view.</p>`;
  }
  const values = screen.fieldValues ?? {};
  const items = screen.fields
    .map((f) => {
      const raw = values[f];
      const text = cellText(raw);
      const value = text ? `<span>${escapeHtml(text)}</span>` : `<span class="empty">—</span>`;
      return `      <div class="fitem"><div class="k">${escapeHtml(prettyLabel(f))}</div><div class="v">${value}</div></div>`;
    })
    .join("\n");
  return `    <div class="fgrid">
${items}
    </div>`;
}

function renderRelatedLists(screen: PrototypeScreen): string {
  if (!screen.relatedLists || screen.relatedLists.length === 0) return "";
  return screen.relatedLists
    .map((rl) => {
      const head = rl.columns.map((c) => `<th>${escapeHtml(prettyLabel(c))}</th>`).join("");
      const body = rl.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cellText(cell))}</td>`).join("")}</tr>`)
        .join("\n              ");
      return `      <article class="slds-card">
        <div class="card-hd">${escapeHtml(rl.title)} <span class="badge">${rl.rows.length}</span></div>
        <div class="card-bd" style="padding:.25rem .5rem;">
          <table class="rl">
            <thead><tr>${head}</tr></thead>
            <tbody>
              ${body}
            </tbody>
          </table>
        </div>
      </article>`;
    })
    .join("\n");
}

function renderAssumptionDrawer(items: PrototypeAssumption[]): string {
  const body =
    items.length === 0
      ? `<p class="asm-empty">No open assumptions for this view.</p>`
      : items
          .map(
            (a) => `      <div class="asm${a.blocking ? " blocking" : ""}" data-assumption-id="${escapeHtml(a.id)}">
        <div class="asm-row">
          <span class="asm-topic">${escapeHtml(a.topic)}</span>
          ${a.blocking ? '<span class="badge warn slds-theme_warning">Blocking</span>' : '<span class="badge">Assumption</span>'}
        </div>
        <div class="asm-stmt">${escapeHtml(a.statement)}</div>
        <div class="asm-btns">
          <button class="btn btn-brand" type="button" data-action="confirm">Confirm</button>
          <button class="btn" type="button" data-action="correct">Correct…</button>
        </div>
      </div>`,
          )
          .join("\n");
  const count = items.length;
  return `  <input type="checkbox" id="asm-toggle" class="asm-toggle" />
  <label for="asm-toggle" class="asm-fab">⚑ Assumptions${count ? ` (${count})` : ""}</label>
  <label for="asm-toggle" class="asm-backdrop"></label>
  <aside class="asm-drawer" aria-label="Assumptions in this view">
    <div class="asm-hd"><h2>Assumptions in this view</h2><label for="asm-toggle" class="asm-x">×</label></div>
    <div class="asm-list">
${body}
    </div>
  </aside>`;
}

function renderScreen(opts: RenderOptions, screen: PrototypeScreen): PrototypeFile {
  const filename = `${slug(screen.name)}.html`;
  const drawer = renderAssumptionDrawer(assumptionsForScreen(screen, opts.assumptions));
  const subtitle = screen.subtitle ? `<p class="data-source">${escapeHtml(screen.subtitle)}</p>` : "";
  const dataSource = `<p class="data-source">Data source: ${escapeHtml(screen.objects.map(prettyLabel).join(", ") || "—")} · stories ${escapeHtml(screen.storyIds.join(", ") || "—")}</p>`;
  const related = renderRelatedLists(screen);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(screen.name)} — ${escapeHtml(opts.sowRef)} prototype</title>
  <style>${BASE_CSS}</style>
</head>
<body>
  <div class="proto-banner">Disposable v1 prototype — illustrative Lightning UI for discovery, not a final build. ${escapeHtml(opts.sowRef)}</div>
${renderNav(opts.screens, filename, opts.sowRef)}
  <div class="page">
${renderHeader(screen)}
    ${subtitle}
    <div class="rtabs"><span class="rtab active">Details</span><span class="rtab">Related</span><span class="rtab">Activity</span></div>
    <div class="rwrap" style="background:#fff;border:1px solid var(--border);border-top:0;border-radius:0 0 .25rem .25rem;padding:.75rem;">
      <div>
        <article class="slds-card">
          <div class="card-hd">Record Detail</div>
          <div class="card-bd">
${renderDetails(screen)}
          </div>
          ${screen.interactions.length ? `<div class="card-ft">Interactions: ${screen.interactions.map((i) => escapeHtml(i)).join(" · ")}</div>` : ""}
        </article>
        ${dataSource}
      </div>
      <div>
${related || '        <article class="slds-card"><div class="card-hd">Related</div><div class="card-bd"><p class="asm-empty">No related lists on this view.</p></div></article>'}
      </div>
    </div>
  </div>
${drawer}
</body>
</html>
`;

  return { filename, title: screen.name, html };
}

/** Render every screen to a self-contained HTML file (plus a linking index). */
export function renderPrototype(opts: RenderOptions): PrototypeFile[] {
  const screens = opts.screens.map((s) => renderScreen(opts, s));

  const links = opts.screens
    .map((s) => `      <li><a href="${slug(s.name)}.html">${escapeHtml(s.name)}</a></li>`)
    .join("\n");
  const index: PrototypeFile = {
    filename: "index.html",
    title: `${opts.sowRef} prototype`,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(opts.sowRef)} prototype</title>
  <style>${BASE_CSS}</style>
</head>
<body>
  <div class="proto-banner">Disposable v1 prototype — illustrative Lightning UI for discovery. ${escapeHtml(opts.sowRef)}</div>
  <div class="page">
    <div class="hl"><div class="hl-top"><div class="hl-icon" style="background:var(--brand)">◆</div><div class="hl-meta"><div class="hl-eyebrow">Prototype</div><h1 class="hl-title">${escapeHtml(opts.sowRef)} — screens</h1></div></div></div>
    <article class="slds-card"><div class="card-hd">Screens (${opts.screens.length})</div><div class="card-bd"><ul style="margin:0;padding-left:1.1rem;line-height:1.9;">
${links}
    </ul></div></article>
  </div>
</body>
</html>
`,
  };

  return [index, ...screens];
}

/** Write rendered files into `dir`, returning the repo-relative paths written. */
export async function writePrototype(dir: string, files: PrototypeFile[]): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  // Clear stale screens from a prior run so the dir holds only this run's set.
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    if (f.endsWith(".html")) await rm(join(dir, f), { force: true }).catch(() => {});
  }
  const written: string[] = [];
  for (const file of files) {
    const path = join(dir, file.filename);
    await writeFile(path, file.html, "utf8");
    written.push(path);
  }
  return written;
}

/**
 * prototype.ts — the HTML/SLDS prototype generator.
 *
 * Pure rendering (no I/O) so it is unit-testable, plus a thin `writePrototype`
 * helper for the file-writing side effect the `proto-build` agent owns. Turns a
 * screen inventory + the assumption register into clickable Lightning-looking
 * pages, each carrying a visible assumption panel — the disposable v1 the client
 * reacts to in discovery (ARCHITECTURE.md §1, slds-fidelity skill).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface PrototypeRelatedList {
  title: string;
  columns: string[];
  rows: string[][];
}

export interface PrototypeScreen {
  name: string;
  /** Context line under the title, e.g. the client and segment. */
  subtitle?: string;
  storyIds: string[];
  /** Backing objects — shown as a small data-source note, not the headline. */
  objects: string[];
  /** Record-detail field labels. */
  fields: string[];
  /** Sample values per field label (so the page reads as real data, not "—"). */
  fieldValues?: Record<string, string>;
  /** Key facts shown as a highlights strip under the header. */
  highlights?: { label: string; value: string }[];
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
 * A compact, self-contained Lightning-flavored stylesheet covering the SLDS
 * classes this generator emits. Inlined into every page so prototypes render
 * fully offline — no CDN, no network — which is what a sandboxed file preview
 * (and an air-gapped discovery laptop) needs.
 */
const BASE_CSS = `
  :root { --brand:#0176d3; --border:#c9c9c9; --bg:#f3f3f3; --weak:#5c5c5c; --warn:#fe9339; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#181818; background:var(--bg); }
  .prototype-banner { background:#faffbd; border-bottom:1px solid #e4e466; padding:.4rem; text-align:center; font-size:.75rem; }
  .slds-tabs_default__nav { display:flex; gap:.25rem; list-style:none; margin:0; padding:0 1rem; border-bottom:1px solid var(--border); background:#fff; }
  .slds-tabs_default__link { display:inline-block; padding:.6rem .9rem; text-decoration:none; color:var(--weak); border-bottom:3px solid transparent; }
  .slds-tabs_default__item.slds-is-active .slds-tabs_default__link { color:var(--brand); border-bottom-color:var(--brand); font-weight:600; }
  .slds-page-header { background:#fff; border:1px solid var(--border); border-radius:.25rem; padding:1rem; margin:.75rem; }
  .slds-page-header__title { font-size:1.25rem; font-weight:700; margin:0; }
  .slds-page-header__name-meta { color:var(--weak); font-size:.8rem; margin:.25rem 0 0; }
  .slds-grid { display:flex; }
  .slds-grid.slds-wrap { flex-wrap:wrap; }
  .slds-grid_align-spread { justify-content:space-between; align-items:center; }
  .slds-gutters { gap:.75rem; }
  .slds-col { flex:1 1 auto; }
  .slds-size_2-of-3 { flex:0 0 64%; max-width:64%; }
  .slds-size_1-of-3 { flex:0 0 33%; max-width:33%; }
  @media (max-width:640px){ .slds-size_2-of-3,.slds-size_1-of-3{ flex-basis:100%; max-width:100%; } }
  .slds-card, .slds-box { background:#fff; border:1px solid var(--border); border-radius:.25rem; }
  .slds-card { margin-bottom:.75rem; }
  .slds-card__header { padding:.75rem 1rem; border-bottom:1px solid #e5e5e5; }
  .slds-card__header-title { font-size:.9rem; font-weight:700; margin:0; }
  .slds-card__body_inner { padding:.75rem 1rem; }
  .slds-card__footer { padding:.6rem 1rem; border-top:1px solid #e5e5e5; color:var(--weak); font-size:.8rem; }
  .slds-box { padding:.75rem; margin-bottom:.5rem; }
  .slds-list_horizontal { display:flex; flex-wrap:wrap; gap:.4rem; list-style:none; margin:0; padding:0; }
  .slds-pill { display:inline-flex; align-items:center; background:#f3f2f2; border:1px solid var(--border); border-radius:999px; padding:.15rem .6rem; font-size:.8rem; margin-right:.25rem; }
  .slds-badge { display:inline-block; background:#ecebea; border-radius:.25rem; padding:.1rem .5rem; font-size:.7rem; text-transform:uppercase; letter-spacing:.03em; }
  .slds-theme_warning { background:var(--warn); color:#2b2826; }
  .slds-button { display:inline-block; width:auto; padding:.4rem .75rem; border-radius:.25rem; border:1px solid var(--brand); background:#fff; color:var(--brand); font-size:.8rem; cursor:pointer; margin-top:.25rem; }
  .slds-button_neutral { border-color:var(--border); color:#181818; }
  .slds-button_stretch { display:block; width:100%; }
  .slds-form-element_horizontal { display:flex; justify-content:space-between; padding:.4rem 0; border-bottom:1px solid #f1f1f1; }
  .slds-form-element__label { color:var(--weak); font-size:.8rem; }
  .slds-text-title_caps { text-transform:uppercase; font-size:.7rem; letter-spacing:.03em; color:var(--weak); font-weight:700; }
  .slds-text-color_weak { color:var(--weak); }
  .slds-text-body_small { font-size:.8rem; }
  .slds-p-horizontal_small { padding-left:.75rem; padding-right:.75rem; }
  .slds-list_dotted { line-height:1.8; }
  .highlights { display:flex; gap:.6rem; flex-wrap:wrap; margin:0 .75rem .75rem; }
  .highlight { background:#fff; border:1px solid var(--border); border-radius:.25rem; padding:.55rem .85rem; min-width:120px; flex:1 1 auto; }
  .highlight .k { font-size:.68rem; color:var(--weak); text-transform:uppercase; letter-spacing:.03em; }
  .highlight .v { font-size:1.05rem; font-weight:700; margin-top:.15rem; }
  .field-value { font-size:.85rem; }
  table.rl { width:100%; border-collapse:collapse; font-size:.85rem; }
  table.rl th { text-align:left; color:var(--weak); font-weight:600; font-size:.7rem; text-transform:uppercase; letter-spacing:.03em; border-bottom:1px solid #e5e5e5; padding:.4rem .5rem; }
  table.rl td { padding:.45rem .5rem; border-bottom:1px solid #f1f1f1; }
  .data-source { color:var(--weak); font-size:.72rem; }
`;

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function renderNav(screens: PrototypeScreen[], activeFilename: string): string {
  const tabs = screens
    .map((s) => {
      const file = `${slug(s.name)}.html`;
      const active = file === activeFilename;
      return `      <li class="slds-tabs_default__item${active ? " slds-is-active" : ""}" role="presentation">
        <a class="slds-tabs_default__link" href="${file}" role="tab" aria-selected="${active}">${escapeHtml(s.name)}</a>
      </li>`;
    })
    .join("\n");
  return `  <div class="slds-tabs_default">
    <ul class="slds-tabs_default__nav" role="tablist">
${tabs}
    </ul>
  </div>`;
}

function renderAssumptionPanel(items: PrototypeAssumption[]): string {
  if (items.length === 0) {
    return `        <p class="slds-text-body_small slds-text-color_weak">No open assumptions for this view.</p>`;
  }
  return items
    .map(
      (a) => `        <div class="slds-box slds-box_x-small slds-m-bottom_x-small" data-assumption-id="${escapeHtml(a.id)}">
          <div class="slds-grid slds-grid_align-spread slds-m-bottom_xx-small">
            <span class="slds-text-title_caps">${escapeHtml(a.topic)}</span>
            ${a.blocking ? '<span class="slds-badge slds-theme_warning">Blocking</span>' : '<span class="slds-badge">Assumption</span>'}
          </div>
          <p class="slds-text-body_small slds-m-bottom_x-small">${escapeHtml(a.statement)}</p>
          <button class="slds-button slds-button_outline-brand slds-button_stretch" type="button">Confirm</button>
          <button class="slds-button slds-button_neutral slds-button_stretch slds-m-top_xx-small" type="button">Correct…</button>
        </div>`,
    )
    .join("\n");
}

function renderFields(screen: PrototypeScreen): string {
  if (screen.fields.length === 0) {
    return `            <p class="slds-text-body_small slds-text-color_weak">No fields specified.</p>`;
  }
  const values = screen.fieldValues ?? {};
  return screen.fields
    .map((f) => {
      const v = values[f];
      const control = v
        ? `<span class="field-value">${escapeHtml(v)}</span>`
        : `<span class="slds-text-color_weak">—</span>`;
      return `            <div class="slds-form-element slds-form-element_readonly slds-form-element_horizontal">
              <span class="slds-form-element__label">${escapeHtml(f)}</span>
              <div class="slds-form-element__control">${control}</div>
            </div>`;
    })
    .join("\n");
}

function renderHighlights(screen: PrototypeScreen): string {
  if (!screen.highlights || screen.highlights.length === 0) return "";
  const cells = screen.highlights
    .map(
      (h) => `    <div class="highlight"><div class="k">${escapeHtml(h.label)}</div><div class="v">${escapeHtml(h.value)}</div></div>`,
    )
    .join("\n");
  return `  <div class="highlights">
${cells}
  </div>`;
}

function renderRelatedLists(screen: PrototypeScreen): string {
  if (!screen.relatedLists || screen.relatedLists.length === 0) return "";
  return screen.relatedLists
    .map((rl) => {
      const head = rl.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
      const body = rl.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
        .join("\n              ");
      return `      <article class="slds-card">
        <div class="slds-card__header"><h2 class="slds-card__header-title slds-text-heading_small">${escapeHtml(rl.title)}</h2></div>
        <div class="slds-card__body slds-card__body_inner">
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

function renderScreen(opts: RenderOptions, screen: PrototypeScreen): PrototypeFile {
  const filename = `${slug(screen.name)}.html`;
  const panel = renderAssumptionPanel(assumptionsForScreen(screen, opts.assumptions));
  const interactions =
    screen.interactions.length > 0
      ? screen.interactions
          .map((i) => `<span class="slds-pill slds-m-right_xx-small"><span class="slds-pill__label">${escapeHtml(i)}</span></span>`)
          .join("")
      : '<span class="slds-text-color_weak">none</span>';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(screen.name)} — ${escapeHtml(opts.sowRef)} prototype</title>
  <style>${BASE_CSS}</style>
</head>
<body>
  <div class="prototype-banner slds-p-around_x-small slds-text-align_center slds-text-body_small">
    Disposable v1 prototype — not a final build. ${escapeHtml(opts.sowRef)}
  </div>
${renderNav(opts.screens, filename)}
  <div class="slds-page-header slds-m-around_small">
    <div class="slds-page-header__row">
      <div class="slds-page-header__col-title">
        <div class="slds-media">
          <div class="slds-media__body">
            <h1 class="slds-page-header__title slds-truncate">${escapeHtml(screen.name)}</h1>
            <p class="slds-page-header__name-meta">${escapeHtml(screen.subtitle ?? `Stories: ${screen.storyIds.join(", ") || "—"}`)}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
${renderHighlights(screen)}
  <div class="slds-grid slds-gutters slds-p-horizontal_small slds-wrap">
    <div class="slds-col slds-size_2-of-3">
      <article class="slds-card">
        <div class="slds-card__header"><h2 class="slds-card__header-title slds-text-heading_small">Record detail</h2></div>
        <div class="slds-card__body slds-card__body_inner">
${renderFields(screen)}
        </div>
        <div class="slds-card__footer slds-text-body_small">Interactions: ${interactions}</div>
      </article>
${renderRelatedLists(screen)}
      <p class="data-source slds-p-horizontal_small">Data source: ${escapeHtml(screen.objects.join(", ") || "—")} · stories ${escapeHtml(screen.storyIds.join(", ") || "—")}</p>
    </div>
    <aside class="slds-col slds-size_1-of-3">
      <article class="slds-card">
        <div class="slds-card__header"><h2 class="slds-card__header-title slds-text-heading_small">Assumptions in this view</h2></div>
        <div class="slds-card__body slds-card__body_inner">
${panel}
        </div>
      </article>
    </aside>
  </div>
</body>
</html>
`;

  return { filename, title: screen.name, html };
}

/** Render every screen to a self-contained HTML file (plus a linking index). */
export function renderPrototype(opts: RenderOptions): PrototypeFile[] {
  const screens = opts.screens.map((s) => renderScreen(opts, s));

  const links = opts.screens
    .map((s) => `      <li class="slds-item"><a href="${slug(s.name)}.html">${escapeHtml(s.name)}</a></li>`)
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
  <div style="padding:1.5rem;">
    <h1 style="font-size:1.5rem;font-weight:700;margin:0 0 1rem;">${escapeHtml(opts.sowRef)} — prototype</h1>
    <p class="slds-text-body_small slds-text-color_weak" style="margin-top:0;">Disposable v1 — click a screen to review it with the client.</p>
    <ul class="slds-list_dotted">
${links}
    </ul>
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
  const written: string[] = [];
  for (const file of files) {
    const path = join(dir, file.filename);
    await writeFile(path, file.html, "utf8");
    written.push(path);
  }
  return written;
}

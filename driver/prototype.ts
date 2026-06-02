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

export interface PrototypeScreen {
  name: string;
  storyIds: string[];
  objects: string[];
  fields: string[];
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

const SLDS_CSS =
  "https://cdnjs.cloudflare.com/ajax/libs/design-system/2.24.4/styles/salesforce-lightning-design-system.min.css";

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
  return screen.fields
    .map(
      (f) => `            <div class="slds-form-element slds-form-element_readonly slds-form-element_horizontal">
              <span class="slds-form-element__label">${escapeHtml(f)}</span>
              <div class="slds-form-element__control"><div class="slds-form-element__static slds-text-color_weak">—</div></div>
            </div>`,
    )
    .join("\n");
}

function renderObjects(screen: PrototypeScreen): string {
  if (screen.objects.length === 0) return "";
  const pills = screen.objects
    .map(
      (o) => `              <li class="slds-item"><span class="slds-pill"><span class="slds-pill__label">${escapeHtml(o)}</span></span></li>`,
    )
    .join("\n");
  return `          <article class="slds-card slds-m-bottom_small">
            <div class="slds-card__header"><h2 class="slds-card__header-title slds-text-heading_small">Objects</h2></div>
            <div class="slds-card__body slds-card__body_inner">
              <ul class="slds-list_horizontal slds-has-dividers_right">
${pills}
              </ul>
            </div>
          </article>`;
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
  <link rel="stylesheet" href="${SLDS_CSS}" />
  <style>
    body { padding: 0; }
    .prototype-banner { background: #faffbd; border-bottom: 1px solid #e4e466; }
  </style>
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
            <p class="slds-page-header__name-meta">Stories: ${escapeHtml(screen.storyIds.join(", ") || "—")}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="slds-grid slds-gutters slds-p-horizontal_small slds-wrap">
    <div class="slds-col slds-size_2-of-3">
${renderObjects(screen)}
      <article class="slds-card">
        <div class="slds-card__header"><h2 class="slds-card__header-title slds-text-heading_small">Record detail</h2></div>
        <div class="slds-card__body slds-card__body_inner">
${renderFields(screen)}
        </div>
        <div class="slds-card__footer slds-text-body_small">Interactions: ${interactions}</div>
      </article>
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
  <link rel="stylesheet" href="${SLDS_CSS}" />
</head>
<body>
  <div class="slds-p-around_medium">
    <h1 class="slds-text-heading_large slds-m-bottom_small">${escapeHtml(opts.sowRef)} — prototype</h1>
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

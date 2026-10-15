/**
 * Full HTML shell for /uma dash (Proposal 10) — the "TUI in a browser".
 *
 * A CSS-grid page with no document scroll: header (search + stats), filter
 * chips, a two-pane body (fact list | detail) and a status-bar footer. All
 * data flows through HTMX fragment swaps; the only hand-written JS is the
 * small keyboard driver at the bottom (spec §8, ≤60 lines).
 *
 * Invariant: the page renders no fact data itself — every fact-shaped byte
 * comes from an /frag/* route so the escaping boundary in fragments.ts
 * stays the single place where record fields meet HTML.
 */

import { escapeHtml } from "./fragments.ts";

const TYPE_CHIPS: Array<[string, string]> = [
  ["", "all"],
  ["decision", "decision"],
  ["pattern", "pattern"],
  ["preference", "preference"],
  ["correction", "correction"],
  ["skill", "skill"],
  ["task", "task"],
  ["note", "note"],
];

function typeChips(): string {
  return TYPE_CHIPS.map(
    ([value, label], i) =>
      `<input type="radio" name="type" value="${escapeHtml(value)}" id="t-${label}"${i === 0 ? " checked" : ""}` +
      ` hx-get="/frag/facts" hx-target="#cards" hx-trigger="change" hx-include="#search,#filters">` +
      `<label for="t-${label}">${label}</label>`,
  ).join("");
}

function scopeChips(): string {
  const chips: Array<[string, string, string]> = [
    ["", "any scope", "s-all"],
    ["global", "🌐 global", "s-global"],
    ["project", "📁 project", "s-project"],
  ];
  return chips
    .map(
      ([value, label, id], i) =>
        `<input type="radio" name="scope" value="${escapeHtml(value)}" id="${id}"${i === 0 ? " checked" : ""}` +
        ` hx-get="/frag/facts" hx-target="#cards" hx-trigger="change" hx-include="#search,#filters">` +
        `<label for="${id}">${label}</label>`,
    )
    .join("");
}

/**
 * The keyboard driver: `/` focuses search, j/k/arrows move a CSS `selected`
 * class, Enter clicks the selected card (cards are buttons with hx-get, so
 * .click() reuses the HTMX path), Esc clears the detail pane, g/G jump.
 * Keys are never swallowed while typing in the search input (except Esc).
 * Avoids template literals so the block stays a plain string constant.
 */
const KEYBOARD_SCRIPT = [
  "(function(){",
  "var DETAIL_PLACEHOLDER='<div class=\"placeholder\">select a fact · Enter opens · Esc clears</div>';",
  "function cards(){return Array.prototype.slice.call(document.querySelectorAll('#cards .card:not(.more)'));}",
  "function selected(){return document.querySelector('#cards .card.selected');}",
  "function move(step,target){var cs=cards();if(!cs.length)return;",
  " var cur=cs.indexOf(selected());var next=target!==undefined?target:cur+step;",
  " if(next<0)next=0;if(next>=cs.length)next=cs.length-1;",
  " cs.forEach(function(c){c.classList.remove('selected');});",
  " cs[next].classList.add('selected');cs[next].scrollIntoView({block:'nearest'});}",
  "document.body.addEventListener('htmx:afterSwap',function(e){",
  " if(e.target.id==='cards'&&cards().length&&!selected()){cards()[0].classList.add('selected');}});",
  "document.addEventListener('keydown',function(e){",
  " var tag=(e.target.tagName||'').toLowerCase();",
  " var typing=tag==='input'||tag==='textarea';",
  " if(e.key==='/'&&!typing){e.preventDefault();document.getElementById('search').focus();return;}",
  " if(e.key==='Escape'){",
  "  if(typing){e.target.blur();}",
  "  else{document.getElementById('detail').innerHTML=DETAIL_PLACEHOLDER;}",
  "  return;}",
  " if(typing){return;}",
  " if(e.key==='j'||e.key==='ArrowDown'){e.preventDefault();move(1);}",
  " else if(e.key==='k'||e.key==='ArrowUp'){e.preventDefault();move(-1);}",
  " else if(e.key==='g'){move(0,0);}",
  " else if(e.key==='G'){move(0,cards().length-1);}",
  " else if(e.key==='Enter'){var s=selected();if(s){e.preventDefault();s.click();}}",
  "});",
  "})();",
].join("\n");

export function renderPage(token: string): string {
  const safeToken = escapeHtml(token);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>UMA DASH</title>
<link rel="stylesheet" href="/assets/dash.css">
<script src="/assets/htmx.min.js"></script>
</head>
<body hx-headers='{"x-uma-token":"${safeToken}"}'>
<div class="app">
  <header>
    <span class="logo">🧠 UMA DASH</span>
    <input id="search" name="q" type="search" placeholder="🔍 search…  ( / to focus )" autocomplete="off"
           hx-get="/frag/facts" hx-target="#cards" hx-trigger="keyup changed delay:300ms" hx-include="#filters">
    <span id="stats" class="stats" hx-get="/frag/stats" hx-trigger="load"></span>
  </header>
  <form id="filters" class="chips" onsubmit="return false">
    <span class="chip-group">${typeChips()}</span>
    <span class="chip-group">${scopeChips()}</span>
  </form>
  <main>
    <section id="list" aria-label="facts">
      <div id="cards" hx-get="/frag/facts" hx-trigger="load" hx-include="#filters"></div>
    </section>
    <section id="detail" aria-label="detail"><div class="placeholder">select a fact · Enter opens · Esc clears</div></section>
  </main>
  <footer><span class="dim">↑↓/jk move · enter open · / search · esc close · click &amp; type both work — read-only, nothing here writes memory</span></footer>
</div>
<script>${KEYBOARD_SCRIPT}</script>
</body>
</html>
`;
}

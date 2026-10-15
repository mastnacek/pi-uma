/**
 * The detail pane of /uma dash: the full record, not just a title and a body
 * (Proposal 10 §13 delta).
 *
 * Every field `uma read --json` returns gets a line: status, validity window,
 * provenance (who generated it, who verified it), task links, the executable
 * AST contract, skill templates and the plasticity/saliency metadata. The
 * engine already hands these over on the detail route, so rendering them costs
 * nothing extra; dropping them made a rich record look like a note.
 */

import type { DashChain } from "./data.ts";
import type { DashFact } from "./record.ts";
import { escapeHtml, renderBodyHtml, scopeLabel, stripMatchMarkers } from "./fragments.ts";

function typeClass(fact: DashFact): string {
  return `t-${escapeHtml(fact.factType)}`;
}

/** `2026-10-12T10:54:47.19+00:00` → `2026-10-12 10:54`. */
export function shortDate(iso?: string): string | undefined {
  if (!iso || iso.length < 16) return iso;
  return iso.slice(0, 16).replace("T", " ");
}

function metaItem(label: string, value: string, className = ""): string {
  return (
    `<span class="meta-item${className ? ` ${className}` : ""}">` +
    `<span class="meta-label">${escapeHtml(label)}</span>${value}</span>`
  );
}

/** Plasticity: the Hebbian fitness view (weight, reinforcements, decay). */
function plasticityLine(fact: DashFact): string | undefined {
  const p = fact.plasticity;
  if (!p) return undefined;
  const parts = [
    `w ${p.weight.toFixed(2)}`,
    `↑${p.reinforcements}`,
    `↓${p.frustrations}`,
    p.half_life_days ? `half-life ${p.half_life_days}d` : undefined,
    p.last_activated ? `last ${shortDate(p.last_activated)}` : undefined,
  ].filter((x): x is string => x !== undefined);
  return parts.join(" · ");
}

/** Saliency: shock level, multiplier and decay immunity. */
function saliencyLine(fact: DashFact): string | undefined {
  const s = fact.saliency;
  if (!s) return undefined;
  const parts = [
    `shock ${s.shock_level.toFixed(2)}`,
    `×${s.multiplier.toFixed(2)}`,
    s.immune_to_decay ? "decay-immune" : undefined,
  ].filter((x): x is string => x !== undefined);
  return parts.join(" · ");
}

function renderContract(fact: DashFact): string {
  const c = fact.contract;
  if (!c) return "";
  const severity = c.severity === "deny" ? "deny" : "warn";
  return (
    `<div class="block">` +
    `<div class="block-head">🧪 executable contract <span class="sev sev-${severity}">${severity}</span>` +
    `<span class="dim"> · ${escapeHtml(c.engine)}</span></div>` +
    `<div class="block-note">${escapeHtml(c.rule.message)}</div>` +
    `<pre class="code">${escapeHtml(c.rule.pattern)}</pre>` +
    (c.rule.inside ? `<div class="block-note dim">inside ${escapeHtml(c.rule.inside)}</div>` : "") +
    `</div>`
  );
}

function renderTemplate(fact: DashFact): string {
  if (!fact.template) return "";
  return (
    `<div class="block">` +
    `<div class="block-head">📐 skill template <span class="dim">(expanded, never executed)</span></div>` +
    `<pre class="code">${escapeHtml(stripMatchMarkers(fact.template))}</pre>` +
    `</div>`
  );
}

/**
 * The supersession chain: what this fact replaced, and in which order. Each
 * revision is itself a readable fact, so the whole chain stays navigable.
 */
export function renderChain(chain: DashChain): string {
  if (chain.revisions.length === 0) return "";
  const rows = chain.revisions
    .map((rev) => {
      const current = rev.id === chain.current;
      const when = shortDate(rev.until ?? rev.since);
      const status = rev.status.toLowerCase();
      return (
        `<button type="button" class="chain-row${current ? " current" : ""}" ` +
        `hx-get="/frag/fact/${encodeURIComponent(rev.id)}" hx-target="#detail" hx-swap="innerHTML">` +
        `<span class="chain-status st-${escapeHtml(status)}">${escapeHtml(status)}</span>` +
        `<span class="chain-title">${escapeHtml(rev.title)}</span>` +
        `<span class="chain-when dim">${escapeHtml(when ?? "")}</span>` +
        (current ? `<span class="chain-current">← current</span>` : "") +
        `</button>`
      );
    })
    .join("");
  return (
    `<div class="block">` +
    `<div class="block-head">🕰 history <span class="dim">· ${chain.length} revision(s)</span></div>` +
    `<div class="chain">${rows}</div>` +
    `</div>`
  );
}

/** The full record view: metadata, contract, template, history, body. */
export function renderDetail(fact: DashFact, chain?: DashChain): string {
  const type = escapeHtml(fact.factType);
  const bodySource = fact.body ?? fact.snippet ?? "";
  const weight = fact.weight !== null ? metaItem("weight", fact.weight.toFixed(2)) : "";
  const statusText = fact.status ?? (fact.deprecated ? "deprecated" : "stable");
  const status = metaItem(
    "status",
    `${fact.deprecated ? "⚠ " : ""}${escapeHtml(statusText)}`,
    fact.deprecated ? "deprecated" : "",
  );
  const validity = [
    fact.validity.since ? `since ${shortDate(fact.validity.since)}` : undefined,
    fact.validity.staleAfter ? `stale after ${shortDate(fact.validity.staleAfter)}` : undefined,
    fact.validity.until ? `until ${shortDate(fact.validity.until)}` : undefined,
  ].filter((x): x is string => x !== undefined);
  const provenance = [
    fact.generatedBy ? `generated by ${fact.generatedBy}` : undefined,
    ...fact.verified.map((v) =>
      [v.by ?? "unknown", shortDate(v.at)].filter(Boolean).join(" @ "),
    ),
  ].filter((x): x is string => x !== undefined);

  const rows: string[] = [
    metaItem("id", escapeHtml(fact.id)),
    metaItem("scope", scopeLabel(fact.scope), `scope ${fact.scope === "global" ? "global" : "project"}`),
    weight,
    status,
    ...validity.map((v) => metaItem("validity", escapeHtml(v))),
    fact.supersedes ? metaItem("supersedes", escapeHtml(fact.supersedes)) : "",
    provenance.length > 0 ? metaItem("provenance", escapeHtml(provenance.join(" · "))) : "",
    fact.spai.length > 0 ? metaItem("spai", escapeHtml(fact.spai.join(" "))) : "",
    fact.links.length > 0 ? metaItem("links", escapeHtml(fact.links.join(" "))) : "",
    plasticityLine(fact) ? metaItem("plasticity", escapeHtml(plasticityLine(fact) ?? "")) : "",
    saliencyLine(fact) ? metaItem("saliency", escapeHtml(saliencyLine(fact) ?? "")) : "",
    fact.tags.length > 0
      ? metaItem("tags", fact.tags.map((t) => `#${escapeHtml(t)}`).join(" "))
      : "",
  ].filter((row) => row.length > 0);

  const description = fact.description
    ? `<div class="description">${escapeHtml(fact.description)}</div>`
    : "";

  return (
    `<div class="detail-head">` +
    `<span class="badge ${typeClass(fact)}">${type.toUpperCase()}</span>` +
    `<h3>${escapeHtml(fact.title)}</h3>` +
    description +
    `<div class="meta">${rows.join("")}</div>` +
    `</div>` +
    renderContract(fact) +
    renderTemplate(fact) +
    (chain ? renderChain(chain) : "") +
    `<div class="body">${renderBodyHtml(bodySource)}</div>`
  );
}

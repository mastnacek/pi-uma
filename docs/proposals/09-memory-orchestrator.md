# Proposal 09: Memory Orchestrator — dedikovaný router v herdr panelu

**Status:** Draft — rozhodnutí potvrzena operátorem 2026-10-10 (viz UMA decision `01M4KKY25T7HZ99QPFC3AEDSB8`, SPAI-017)
**Cílová vrstva:** `uma-core/src/fastbrain/route.rs` (nový), `pi-orchestrator` plugin (nový, tenký), herdr workspace layout
**Vychází z:** 04-internal-council-and-prudence.md, 08-testing-methodology.md

---

## 1. Premise

Frontier model je ~50× dražší než levný (premise pi-orch-guard). Ale dnes stejný
drahý model platí i za **logistiku**: rozhodování, co je v paměti, komu úkol patří,
kam otevřít nový panel. Orchestrátor je dedikovaná pi instance, jejíž jediná práce je:

1. **Spravovat paměť dobře** — vyladěný system prompt + uma-memory-pi skill, aby
   bleskově a správně používala UMA (priming, recall, supersede, humility).
2. **System-1 routing** — rozeznat, co komu předat: offline markery → Jev →
   vlastní model s velkým kontextem jako escalation floor.
3. **Otevírat a krmí herdr panely** — delegace je nová pi instance v herdr
   tabu/panelu, **nikoli pi subagent**.

### Proč ne subagenty

Operátor chce vidět, co delegáti dělají, a moci jim lehce vstoupit do okna a změnit
zadání. Herdr panely jsou plné pi instance s vlastní TUI — pozorovatelné a
převzatelné. Subagenty jsou slepé, jednorázové procesy.

---

## 2. Architektura

```text
┌─ herdr workspace ───────────────────────────────────┐
│ ┌────────────────┐                                  │
│ │ ORCHESTRATOR   │  pi instance:                    │
│ │ - velký model  │  - model + reduced thinking      │
│ │ - uma skill    │  - tuned system prompt           │
│ │ - router plugin│  - pi-orchestrator plugin        │
│ └───────┬────────┘                                  │
│         │ herdr tab create + agent prompt           │
│         ▼              ▼              ▼             │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐      │
│  │ pane:      │ │ pane:      │ │ pane:      │      │
│  │ pi-uma dev │ │ mozek_rust │ │ lotus task │      │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘      │
└────────┼──────────────┼──────────────┼─────────────┘
         ▼              ▼              ▼
      UMA central index (sdílená paměťová sběrnice,
      scopes per projekt, cross-scope recall přes index)
```

### Tok jednoho promptu

```text
user prompt
   │
   ▼
┌─────────────────────────────────────────┐
│ 1. offline markery (fastbrain/offline)  │  0 ms, 0 Kč
│    - hotová /slash trasa? → rovnou      │
│    - známe markery → typ úkolu          │
└───────────────┬─────────────────────────┘
                │ uncertain
                ▼
┌─────────────────────────────────────────┐
│ 2. Jev (OpenRouter classifier)          │  ~ms, haléře
│    route_task(prompt) → specialist,     │
│    context_slice, confidence            │
└───────────────┬─────────────────────────┘
                │ low confidence / novel
                ▼
┌─────────────────────────────────────────┐
│ 3. Orchestrátor sám (velký kontext)     │  dražší, jen výjimky
│    - rozhodne trasu, složí handoff      │
│    - UMA priming → relevantní fakty     │
└───────────────┬─────────────────────────┘
                ▼
   herdr tab create → pi instance v projektu
   herdr agent prompt <handoff + uma priming>
   herdr agent wait (blocked → operátor vidí)
```

---

## 3. Komponenty k výstavbě

### 3.1 `uma-core/src/fastbrain/route.rs` (nový, VSA Rust core)

```rust
pub struct RouteVerdict {
    pub specialist: Specialist,      // enum nebo project scope
    pub context_slice: Vec<FactId>,  // UMA priming pro handoff
    pub confidence: f64,
    pub decided_by: Backend,         // Offline | Jev
}

pub fn route_task(prompt: &str, judge: Judge) -> Result<Judgment<RouteVerdict>, String>
```

- Offline vrstva: markery per projekt/specialista (souborové domény, jazyky,
  klíčová slova z titulků faktů ve scope) — deterministická, testovatelná v `cargo test`.
- Jev vrstva: jeden levný classifier call s kandidáty scopes z `uma scopes`.
- Výstup je **read-only verdict** — delegaci vykonává až plugin (stejný vzor
  jako skeptic/humility: jádro radí, plugin jedná).

### 3.2 `pi-orchestrator` plugin (nový, tenký, VSA)

Composition root + slices; tools pro orchestrátorovu pi instanci:

| Tool | Funkce |
|------|--------|
| `orch_route` | zavolá `uma fastbrain route` (CLI) → verdict |
| `orch_delegate` | `herdr tab create` + spawn pi v projektu + `agent prompt` s handoffem |
| `orch_status` | `herdr agent list` — stavy delegátů (idle/working/blocked/done) |
| `orch_collect` | přečte výsledek delegáta (`herdr agent read`) a zapíše do UMA |

Slash commands (hotové trasy, obcházejí autonomní routing):
- `/orch uma <úkol>`, `/orch mozek <úkol>`, `/orch lotus <úkol>` — přímá delegace
- `/orch auto <prompt>` — plný tiered routing
- `/orch status` — přehled panelů

### 3.3 Orchestrator pane konfigurace

- `.pi/settings.json` v orchestrator workspace: model s velkým kontextem,
  snížené thinking (nativní pi nastavení), žádné těžké pluginy kromě pi-uma
  a pi-orchestrator.
- System prompt (prompt template): "Jsi dispečer paměti. Nikdy neřeš úkoly sám.
  Každý úkol: uma recall → route → delegate → collect → supersede learnings."
- Skill: `uma-memory-pi` (existuje) + nový `orchestrator` skill s runbookem.

---

## 4. Rizika a otevřené otázky

| Riziko | Mitigace |
|--------|----------|
| **Rekurze** — orchestrátor deleguje sám sobě | `PI_SUBAGENT` guard neplatí (delegáti jsou plné instance); orchestrator pane má hardcoded banlist cílů + lock soubor v herdr workspace |
| **Zdvojená fakturace** — prompt projde Jev i orchestrátorem | tiered exit-early: offline hit ≥0.9 confidence = žádné další volání |
| **Delegát se ztratí** | `herdr agent wait` se stavy; blocked = operátor vidí a zasáhne (to je pointa) |
| **UMA write storms** z N panelů | WAL concurrency suite (SPAI-016) už to pokrývá; cross-process test prokázal bezpečnost |
| **Kdo píše do čí scope** | delegát píše do project scope svého projektu; orchestrátor jen do global — dohoda na konvenci |

Otevřené: výběr modelu orchestrátora (velký kontext vs. cena), jestli routing
verdikt logovat jako UMA `task` fakty (metriky přesnosti routingu do budoucna).

---

## 5. Fáze implementace

1. **Fáze A — routing core:** `fastbrain/route.rs` + offline markery + testy; CLI `uma route check "<prompt>"` (read-only, vzor `recall check`).
2. **Fáze B — delegační plugin:** `pi-orchestrator` s `orch_delegate` nad herdr CLI; slash commands pro hotové trasy.
3. **Fáze C — orchestrator pane:** workspace layout, system prompt, settings; ruční ověření loopu route → delegate → collect.
4. **Fáze D — Jev vrstva + metriky:** `judge=jev` pro route; logging verdiktů; accuracy dashboard (vazba na proposal 08, Fáze 4 continuous eval).

Vazby: pi-orch-guard (hook vzor), pi-jev-hud (vizualizace Jev verdiktů),
pi-decision-gate (schvalování), pi-herdr-plugin-dev (herdr plugin know-how),
herdr socket API (`agent prompt/wait/read`, `tab create`).

---

*Vzniklo z konverzace po UMA-Eval session 1; rozhodnutí operátora zaznamenána
v UMA (`01M4KKY25T7HZ99QPFC3AEDSB8`).*

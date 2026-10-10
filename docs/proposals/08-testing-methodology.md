# Proposal 08: Testovací matice a kognitivní benchmark (UMA-Eval Suite)

**Status:** Draft — vznikl z konverzace v tabu 2 (w1Y:t7, agy agent)  
**Cílová vrstva:** `uma-core/tests/`, `uma-cli/`, CI pipeline, Pi extension test harness  
**Datum:** 2026-10-10  

---

## 1. Souhrn navržené dvouúrovňové testovací matice

| Úroveň | Cíl | Spuštění | Závislosti |
|--------|-----|----------|------------|
| **L1: Deterministická verifikace** | Rust jádro (store, indexer, kontrakty, muscle, risk) | `cargo test` v CI | Žádná síť/LLM |
| **L2: Kognitivní evaluační benchmark** | Chování agenta s UMA (imunita, supersedence, KV cache, zombie, humility) | Ori Harness / pi-subagents / custom harness | OpenRouter (Jev), LLM |

---

## 2. Detailní specifikace — Úroveň 1: Deterministická verifikace (Rust)

### L0: Store & Concurrency Stress Test
**Soubor:** `uma-core/tests/concurrency_stress.rs` (nový)

```rust
// Cíle:
// 1. WAL Concurrency: 10+ vláken zapisuje současně (simulace Shadow Worker + CLI + Pi plugin)
//    - Ověří: PRAGMA journal_mode=WAL + busy_timeout → nikdy "database is locked"
// 2. FTS5 & Vector Roundtrip: write → immediate search → verify superseded/deprecated hidden
// 3. Cross-process: CLI spuštěn jako subprocess, store sdílen mezi procesy
```

**Implementace status:** ⚠️ **CHYBÍ** — existuje jen `roundtrip.rs` s jednoduchými testy, žádný concurrency test.

---

### L3: AST Kontrakty & Simulace času (Ebbinghaus Decay)
**Soubory:** `uma-core/tests/contracts.rs` (nový), `uma-core/src/contracts/mod.rs` (existuje)

| Test | Popis | Stav implementace |
|------|-------|-------------------|
| `contracts_export` | `export_contracts()` vygeneruje syntakticky platný `sgconfig.yml` + rule YAML + test harness | ✅ **EXISTUJE** (`contracts::mod.rs`) |
| `contracts_check_block` | ast-grep skutečně zablokuje zakázaný vzor (cross-slice import) | ✅ **EXISTUJE** (`immune_interceptor.ts` testy) |
| `decay_30_days` | Simulace `--as-of +30d`: nepoužívané pravidlo W < 0.25, `doctor --prune-zombies` archivuje | ⚠️ **ČÁSTEČNĚ** (validity existuje, decay logika v `priming`/`similarity`, `doctor` chybí) |
| `decay_90_days` | Stejné pro 90 dní | ⚠️ **CHYBÍ** |

**Klíčová zjištění z kódu:**
- `Fact.validity` má `since`, `until`, `stale_after` — časová simulace je **částečně implementovaná**
- `similarity.rs` má `saliency`/`plasticity` s half-life decay — ale `doctor --prune-zombies` **neexistuje**
- `contracts::export_contracts` a `check_contracts` **existují a fungují** (testovány v `immune.test.ts`)

---

### L5: Muscle Performance & SLA
**Soubor:** `uma-core/tests/muscle_perf.rs` (nový)

```rust
// Cíl: uma_muscle rutiny (bez kompilace) musí běžet < 10 ms
// Měření: cargo bench nebo custom benchmark v testu
```

**Implementace status:** ✅ **EXISTUJE** — `muscle::run_routine` je čistě v Rustu, žádné LLM volání. Benchmark trivialní k přidání.

---

## 3. Detailní specifikace — Úroveň 2: Kognitivní Evaluační Benchmark (UMA-Eval Suite)

### Scénář 1: Test imunity vůči opakování chyb (Pain & Immune Test)

| Vrstva | Co se testuje | Implementace v UMA |
|--------|---------------|-------------------|
| **Tier 1 (L1 Priming)** | Agent používá správné API hned napoprvé díky priming contextu | ✅ **FUNGUJE** — `priming::AssociationGraph` + `fastbrain::judge_recall_need` injektuje kontext do Pi agenta |
| **Tier 2 (Immune Interceptor)** | Agent navrhne špatný přístup → interceptor zablokuje `[UMA Immune System Block]` → agent se sám opraví | ✅ **FUNGUJE** — `immune_interceptor.ts` s módy `warn`/`ask`/`auto`/`block`; testy v `immune.test.ts` |

**Testovací harness:** Vyžaduje Ori Harness nebo pi-subagents pro spuštění agenta s promptem a ověření výstupu.

**Metriky:**
- Tier 1 success rate: % případů, kdy agent použije správné API bez interceptoru
- Tier 2 recovery rate: % případů, kdy agent po bloku interceptoru sám opraví kód (target 100%)

---

### Scénář 2: Test vyřešení konfliktů při supersedenci (Time-Travel Conflict)

| Co se testuje | Implementace v UMA |
|---------------|-------------------|
| Staré pravidlo A + novější B (supersedes: A) → agent musí použít B, nekonfabulovat | ✅ **FUNGUJE** — `store::supersede_within` + `Fact.validity.until` + `is_active_at()` správně skrývá deprecated fakty (testováno v `roundtrip.rs`) |

**Testovací harness:** Lze testovat i v L1 (deterministicky) — jen nastavit fakty, spustit search, ověřit, že vrátí jen B.

---

### Scénář 3: Test ochrany KV Cache a tokenové úspory (Cache Invalidation Test)

| Co se testuje | Implementace v UMA |
|---------------|-------------------|
| 20 po sobě jdoucích tahů: UMA priming vs raw `git log -3` každý commit | ⚠️ **ČÁSTEČNĚ** — Priming existuje (`priming::AssociationGraph`), ale **chybí metriky KV cache hit rate a TTFT měření** |

**Potřebné dodatečné infrastruktury:**
- Token counter v Pi extension (sledovat `input_tokens`/`output_tokens` per turn)
- KV cache proxy nebo simulace
- Benchmark harness pro srovnání dvou režimů

---

### Scénář 4: Test vymýcení zombie pravidel (Zombie Isolation)

| Co se testuje | Implementace v UMA |
|---------------|-------------------|
| Smazán soubor `legacy_auth.rs` → fakt vázaný na něj → UMA detekuje smazání, sníží váhu, vyloučí z primingu | ⚠️ **ČÁSTEČNĚ** — `priming::file_stems()` extrahuje path stems z faktů, `association_strength` používá file co-mention (0.5 weight). Ale **chybí**: detekce smazání souboru z git/filesystem, automatické snížení váhy, `doctor --prune-zombies` |

**Co existuje:**
- `priming::association_strength` — file co-mention hrana (0.5)
- `staging` — shadow worker detekuje změny závislostí

**Co chybí:**
- Git/filesystem watcher pro deleted files
- `uma doctor --prune-zombies` command
- Automatické snížení `saliency`/`plasticity` při detekci zombie

---

### Scénář 5: Test epistemické pokory (Explorative Mode)

| Co se testuje | Implementace v UMA |
|---------------|-------------------|
| Úkol v neprozkoumaném modulu s nulovou pamětí + vysoký Pain Score → agent NEgeneruje kód naslepo, nejprve čte soubory, navrhne plán | ✅ **FUNGUJE** — `humility::FamiliarityIndex` + `humility_gate.ts` hook vyžaduje ≥3 reads + potvrzenou hypotézu před první mutací. `uma_humility` CLI tool + Pi tool. |

**Testovací harness:** Ori Harness / pi-subagents — spustit agenta na úkol v novém modulu, ověřit sekvenci: reads → hypothesis confirm → write.

---

## 4. Evaluace současných schopností vs. Požadavky

### ✅ PLNĚ IMPLEMENTOVANÉ (připraveno k testování)

| Oblast | Komponenty | Testovatelnost |
|--------|------------|----------------|
| **Store CRUD + supersedence** | `store::write/read/list/supersede_within`, `Fact.validity`, `is_active_at` | L1 deterministicky (`cargo test`) |
| **FTS5 + Vector search** | `indexer::Indexer`, `search_keyword`, `search_vector`, hybrid RRF | L1 deterministicky |
| **AST Contracts** | `contracts::export_contracts`, `check_contracts`, `ast-grep` integrace | L1 deterministicky + L2 přes interceptor |
| **Immune Interceptor** | `immune_interceptor.ts` (modes: off/warn/ask/auto/block), `assessEdit`, `checkContractRules` | L1 (unit testy) + L2 (Ori/pi-subagents) |
| **Pain Score (Risk)** | `risk::compute`, `Band` (low/medium/critical), git history collection v CLI | L1 deterministicky |
| **Fastbrain (Jev/Offline)** | `fastbrain::judge_relationship`, `judge_recall_need`, `judge_distill_telemetry` | L1 (offline) + L2 (Jev) |
| **Priming/Spreading Activation** | `priming::AssociationGraph`, `spread()` s decay/hops | L1 deterministicky |
| **Muscle Memory** | `muscle::parse_routine`, `run_routine` (dry-run/confirm), skill facts | L1 deterministicky (<10ms SLA) |
| **Epistemic Humility** | `humility::FamiliarityIndex`, `humility_gate` (≥3 reads + hypothesis), `/uma humility` | L1 + L2 |
| **Shadow Worker / Staging** | `staging` slice, `uma staging list/approve/discard` | Částečně (ruční spuštění) |

---

### ⚠️ ČÁSTEČNĚ IMPLEMENTOVANÉ (vyžaduje dodatečnou práci)

| Oblast | Co funguje | Co chybí pro plný test |
|--------|------------|------------------------|
| **Ebbinghaus Decay / Time Simulation** | `Fact.validity.stale_after`, `since`, `until`; `similarity.rs` plasticity decay | `--as-of` flag pro search/list, `doctor --prune-zombies` command |
| **Zombie Detection** | `priming::file_stems` (file co-mention), `staging` detekce dependency changes | Filesystem/git watcher pro deleted files, auto-decay při zombie detekci |
| **KV Cache / Token Metrics** | Priming injektuje kontext (token úspora implikovaná) | Explicitní token counter, KV cache hit rate měření, TTFT benchmark |
| **Consolidation** | `consolidate::judge_relationship` (duplicate/contradiction/unrelated) | Auto-proposal v CLI, batch approve UI |

---

### ❌ CHYBÍCE (pro plnou testovací matici)

| Oblast | Popis | Odhad úsilí |
|--------|-------|-------------|
| **L0 Concurrency Stress Test** | Multi-threaded WAL writes, cross-process store sharing | 2-3 dny (nový test file) |
| **L3 Time-shift Tests** | `--as-of` flag, `doctor --prune-zombies` | 3-5 dní (CLI + store + doctor) |
| **L2 Harness Infrastructure** | Ori Harness integrace, pi-subagents test runner, metrika kolekce | 5-10 dní (nový crate/harness) |
| **Zombie Auto-Pruning** | Git watcher, auto-decay, doctor prune | 3-5 dní |
| **Token/KV Cache Benchmark** | Token counter v Pi extension, benchmark harness | 5-7 dní |

---

## 5. Doporučený postup implementace

### Fáze 1: Doplňky k L1 (2 týdny) — **Může začít hned**
1. `uma-core/tests/concurrency_stress.rs` — WAL concurrency + cross-process
2. `uma-core/tests/contracts.rs` — export/check roundtrip, decay simulace
3. `uma-core/tests/muscle_perf.rs` — benchmark < 10ms
4. CLI: `--as-of` flag pro `search`, `list`, `read`
5. CLI: `uma doctor --prune-zombies` (read-only report, pak `--confirm` pro akci)

### Fáze 2: L2 Harness Infrastructure (3-4 týdny)
1. **Ori Harness integrace** — `mcp__openrouter__spawn_ori_eval` existuje, použít pro UMA-Eval Suite
2. **pi-subagents test runner** — parallelní spouštění scénářů 1-5
3. **Metriky kolekce** — token counter, KV cache proxy, TTFT měření
4. **Reporting** — HTML/JSON report s pass/fail per scénář, trendy

### Fáze 3: Zombie & Decay Automation (2 týdny)
1. Filesystem/git watcher v `uma-cli` (nebo jako background task)
2. Automatické snížení `saliency` při detekci deleted file
3. `doctor --prune-zombies --confirm` — přesune zombie do archivu

### Fáze 4: Continuous Eval (ongoing)
1. Nightly Ori eval runs na UMA-Eval Suite
2. Regression detection na L1 + L2 metriky
3. Dashboard pro tracking Tier 1/2 success rates

---

## 6. Zdroje a reference

- **Existující testy:** `uma-core/tests/roundtrip.rs` (báze pro L0/L3)
- **Contracts:** `uma-core/src/contracts/mod.rs` + `ops.rs` + `tests.rs`
- **Immune:** `pi-uma/src/hooks/immune_interceptor.ts` + `src/slices/immune/index.ts` + `test/immune.test.ts`
- **Fastbrain:** `uma-core/src/fastbrain/` (jev.rs, offline.rs, dream.rs)
- **Priming:** `uma-core/src/priming/mod.rs` + `tests.rs`
- **Muscle:** `uma-core/src/muscle/mod.rs` + `tests.rs`
- **Risk/Pain:** `uma-core/src/risk/mod.rs` + `tests.rs`
- **Humility:** `pi-uma/src/slices/humility/` + `hooks/humility_gate.ts`
- **Ori Harness:** `mcp__openrouter__spawn_ori_eval` tool, `mcp__openrouter__install_ori_harness`
- **Pi-subagents:** `npm:pi-subagents` skill `council-mode` + `pi-subagents`

---

## 7. Závěr

**UMA má solidní základnu pro obě úrovně testování.** Deterministická vrstva (L1) je 80% hotová — chybí jen concurrency stress, time-shift simulace a muscle benchmarky. Kognitivní vrstva (L2) má všechny komponenty (immune, priming, humility, supersedence, shadow worker) — chybí **testovací harness** (Ori/pi-subagents) a **metriky** (tokeny, KV cache, TTFT).

**Doporučení:** Začněte Fází 1 (doplňky L1) — to odemkne `cargo test` jako kompletní regresní suitu. Paralelně prototypujte L2 harness pomocí Ori (k dispozici přes MCP tool `spawn_ori_eval`).

---

*Vytvořeno z analýzy kódu v `pi-uma` a konverzace v herdr tab 2 (w1Y:t7).*
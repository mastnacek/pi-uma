import type { Locale } from "./i18n.js";

export interface CommandHelpStrings {
  // Level 1 subcommands
  cmdHelp: string;
  cmdSearch: string;
  cmdList: string;
  cmdListGlobal: string;
  cmdRead: string;
  cmdReindex: string;
  cmdTimeline: string;
  cmdExport: string;
  cmdDoctor: string;
  cmdLang: (cur: string) => string;
  cmdAutoApprove: (cur: boolean) => string;
  cmdRecall: (cur: boolean) => string;
  cmdAppend: (cur: boolean) => string;
  cmdJudge: (cur: string) => string;
  cmdImmune: (cur: string) => string;
  cmdHud: (cur: boolean) => string;
  cmdReview: string;
  cmdStaging: string;
  cmdDebt: string;
  cmdHumility: string;
  cmdMuscle: string;
  cmdSkeptic: string;

  // Level 2 & 3 parameters
  paramAutoApproveOn: string;
  paramAutoApproveOff: string;
  paramRecallOn: string;
  paramRecallOff: string;
  paramAppendOn: string;
  paramAppendOff: string;
  paramJudgeOff: string;
  paramJudgeJev: string;
  paramImmuneOff: string;
  paramImmuneWarn: string;
  paramImmuneAsk: string;
  paramImmuneAuto: string;
  paramImmuneBlock: string;
  paramHudOn: string;
  paramHudOff: string;
  paramHumilityOn: string;
  paramHumilityOff: string;
  paramGlobalSuffix: string;
  activeMarker: (active: boolean) => string;
  enumMarker: (val: string) => string;
}

const csHelp: CommandHelpStrings = {
  cmdHelp: "Podrobná nápověda s popisem architektury a všech parametrů",
  cmdSearch: "Vyhledávání v paměti podle klíčových slov (BM25 vyhledávač)",
  cmdList: "Výpis aktivních rozhodnutí, preferencí a pravidel projektu",
  cmdListGlobal: "Výpis globálních uživatelských vzorů a preferencí napříč projekty",
  cmdRead: "Detailní zobrazení konkrétního paměťového faktu podle jeho ULID",
  cmdReindex: "Přestavba centralizovaného SQLite indexu ze zdrojových Markdown souborů",
  cmdTimeline: "Rekonstrukce vývoje pravidel v čase (historie nahrazování faktu)",
  cmdExport: "Export paměti do přenositelného standardního balíčku OKF v0.2",
  cmdDoctor: "Diagnostická čtecí kontrola zdraví paměťového storu a SQLite indexu",
  cmdLang: (cur) => `Přepnutí jazyka rozhraní (aktuálně: ${cur})`,
  cmdAutoApprove: (cur) =>
    `Schvalovací okno paměti (aktuálně: ${cur ? "přímý zápis bez okna" : "interaktivní schvalování"})`,
  cmdRecall: (cur) =>
    `Fastbrain recallová brána (aktuálně: ${cur ? "zapnuto • automatické přitahování" : "vypnuto • explicitní"})`,
  cmdAppend: (cur) =>
    `Připojování pravidel do System Promptu (aktuálně: ${cur ? "zapnuto • pravidla v promptu" : "vypnuto"})`,
  cmdJudge: (cur) =>
    `Způsob hodnocení dotazu pro recall (aktuálně: ${cur === "jev" ? "sémantický Jev" : "lokální offline markery"})`,
  cmdImmune: (cur) =>
    `Kognitivní imunitní interceptor (aktuálně: režim ${cur})`,
  cmdHud: (cur) =>
    `Stavový řádek a HUD widget nad editorem (aktuálně: ${cur ? "zobrazen" : "skryt"})`,
  cmdReview: "Otevře interaktivní okno pro kontrolu konceptů zachycených pozorovatelem (Shadow Brain)",
  cmdStaging: "Správa konceptů v čekárně (review | list | approve | discard)",
  cmdDebt: "Záznamník kognitivního dluhu (sledování otevřených závazků)",
  cmdHumility: "Epistemická pokora: vyžaduje prozkoumání neznámého subsystému před mutací",
  cmdMuscle: "Svalová paměť: spouštění a správa kurátorských procedurálních rutin",
  cmdSkeptic: "Oponentura: kritické posouzení navržené změny před provedením",

  paramAutoApproveOn: "Ukládá fakta do paměti přímo bez zobrazení schvalovacího okna",
  paramAutoApproveOff: "Zobrazí interaktivní okno pro schválení, editaci a překlad před zápisem",
  paramRecallOn: "Automaticky analyzuje dotaz a přitáhne relevantní fakta z paměti jen když je potřeba",
  paramRecallOff: "Recall zůstává explicitní (agent volá uma_search pouze když sám potřebuje)",
  paramAppendOn: "Vloží aktivní rozhodnutí a pravidla přímo do promptu modelu před každým tahem",
  paramAppendOff: "Pravidla se do promptu modelu automaticky nevkládají (výchozí stav, šetří kontext)",
  paramJudgeOff: "Bleskové lokální vyhodnocení klíčových slov (0 ms, zdarma, offline)",
  paramJudgeJev: "Sémantické vyhodnocení dotazu přes model TypeSafe Jev na OpenRouteru",
  paramImmuneOff: "Imunitní interceptor vypnut, žádné kontroly editací kódu",
  paramImmuneWarn: "Při dotyku pravidla zobrazí varování v TUI, ale kód nikdy nezablokuje",
  paramImmuneAsk: "Při dotyku pravidla či kontraktu vyvolá potvrzovací dialog pro operátora",
  paramImmuneAuto: "Při porušení deterministického AST kontraktu okamžitě zablokuje akci",
  paramImmuneBlock: "Přísné okamžité blokování porušení deterministických AST kontraktů",
  paramHudOn: "Zobrazí stavový řádek a HUD widget s informacemi o UMA nad editorem",
  paramHudOff: "Skryje stavový řádek a HUD widget nad editorem",
  paramHumilityOn: "Před mutací neznámého subsystému vyžaduje přečtení alespoň 3 souborů a hypotézu",
  paramHumilityOff: "Běžný režim bez povinného zkoumání neznámého kódu",
  paramGlobalSuffix: " (globálně pro všechny projekty v ~/.pi/agent/uma.json)",
  activeMarker: (active) => (active ? " · ● ZAPNUTO" : " · ○ VYPNUTO"),
  enumMarker: (val) => (val ? ` · ● AKTIVNÍ: ${val.toUpperCase()}` : ""),
};

const enHelp: CommandHelpStrings = {
  cmdHelp: "Detailed architecture guide and configuration documentation",
  cmdSearch: "Search memory facts using BM25 keyword search",
  cmdList: "List active decisions, preferences, and project patterns",
  cmdListGlobal: "List global user preferences and cross-project decisions",
  cmdRead: "Display complete memory fact content by its ULID identifier",
  cmdReindex: "Rebuild centralized SQLite index from markdown files",
  cmdTimeline: "Reconstruct supersession history and rule evolution over time",
  cmdExport: "Export memory as a portable OKF v0.2 bundle",
  cmdDoctor: "Read-only health diagnostic for store files and SQLite index",
  cmdLang: (cur) => `Switch user interface language (current: ${cur})`,
  cmdAutoApprove: (cur) =>
    `Review modal toggle (current: ${cur ? "direct save without modal" : "interactive modal"})`,
  cmdRecall: (cur) =>
    `Fastbrain recall gate (current: ${cur ? "on • automatic recall" : "off • explicit only"})`,
  cmdAppend: (cur) =>
    `System prompt rules append (current: ${cur ? "on • rules in prompt" : "off"})`,
  cmdJudge: (cur) =>
    `Recall judge transport (current: ${cur === "jev" ? "semantic Jev" : "local offline heuristics"})`,
  cmdImmune: (cur) =>
    `Cognitive immune interceptor (current: mode ${cur})`,
  cmdHud: (cur) =>
    `Status line and HUD widget above editor (current: ${cur ? "visible" : "hidden"})`,
  cmdReview: "Interactive review modal for staged drafts captured by the Shadow Brain",
  cmdStaging: "Manage staged drafts (review | list | approve | discard)",
  cmdDebt: "Prospective Debt Ledger (track open cognitive obligations)",
  cmdHumility: "Epistemic humility: explore unfamiliar code before mutating",
  cmdMuscle: "Procedural muscle memory: run and manage curated routines",
  cmdSkeptic: "Adversarial critique of a proposed intent before execution",

  paramAutoApproveOn: "Save facts directly to memory without showing review modal",
  paramAutoApproveOff: "Show interactive review modal with translation, wrapping, and scrolling",
  paramRecallOn: "Analyze prompts before the turn and inject relevant memory facts conditionally",
  paramRecallOff: "Recall stays explicit (agent queries memory via tools only when needed)",
  paramAppendOn: "Inject active project rules into the leading system prompt before each turn",
  paramAppendOff: "Do not inject rules into system prompt automatically (default, saves tokens)",
  paramJudgeOff: "Instant offline keyword heuristics (0 ms, 0 cost, runs offline)",
  paramJudgeJev: "Semantic prompt triage via TypeSafe Jev model on OpenRouter",
  paramImmuneOff: "Immune interceptor disabled, no edit inspection",
  paramImmuneWarn: "Display warnings in TUI on rule matches, never block",
  paramImmuneAsk: "Show interactive confirmation dialog on rule breaches (default safe mode)",
  paramImmuneAuto: "Hard-block deterministic AST invariant contract breaches immediately",
  paramImmuneBlock: "Strict immediate block for deterministic AST invariant breaches",
  paramHudOn: "Display UMA status line and HUD widget above editor",
  paramHudOff: "Hide UMA status line and HUD widget above editor",
  paramHumilityOn: "Require reading >=3 files and confirming hypothesis before mutating unfamiliar code",
  paramHumilityOff: "Normal operation without mandatory explorative reads",
  paramGlobalSuffix: " (globally across all projects in ~/.pi/agent/uma.json)",
  activeMarker: (active) => (active ? " · ● ACTIVE" : " · ○ INACTIVE"),
  enumMarker: (val) => (val ? ` · ● ACTIVE: ${val.toUpperCase()}` : ""),
};

export function commandHelpFor(locale: Locale): CommandHelpStrings {
  return locale === "cs" ? csHelp : enHelp;
}

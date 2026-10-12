export const LOCALES = ["en", "cs"] as const;
export type Locale = (typeof LOCALES)[number];

export interface Strings {
  proposalHeader: string;
  typeLabel: string;
  scopeLabel: string;
  tagsLabel: string;
  bodyLabel: string;
  actionApprove: string;
  actionEditTitle: string;
  actionEditBody: string;
  actionEditTags: string;
  actionToggleScope: string;
  actionReject: string;
  editPromptTitle: string;
  editPromptBody: string;
  editPromptTags: string;
  editInstruction: string;
  savedNotification: string;
  rejectedNotification: string;
  noFactsFound: string;
  langUpdated: string;
  cmdUsage: string;
  searchUsage: string;
  timelineUsage: string;
  exportUsage: string;
  reindexDone: string;
  langCurrent: string;
  autoApproveEnabled: string;
  autoApproveDisabled: string;
  autoApproveCurrent: string;
  recallGateEnabled: string;
  recallGateDisabled: string;
  recallGateCurrent: string;
  recallJudgeLabel: string;
  appendEnabled: string;
  appendDisabled: string;
  appendCurrent: string;
  detailedHelp: string;
  compHelp: string;
  immuneModeEnabled: string;
  immuneModeCurrent: string;
  immuneModeLabel: string;
  hudEnabled: string;
  hudDisabled: string;
  hudCurrent: string;
  debtAutoCaptured: string;
  debtStillOpen: string;
  humilityDialogTitle: string;
  humilityGateEnabled: string;
  humilityGateDisabled: string;
  humilityGateCurrent: string;
  muscleDialogTitle: string;
  muscleRunConfirm: string;
  muscleStepsLabel: string;
  muscleProposalStaged: string;
  descUmaCommand: string;
  scopeGlobal: string;
  scopeProject: string;
  supersedesLabel: string;
  templateLabel: string;
  staleAfterLabel: string;
  sinceLabel: string;
  noTags: string;
  titleLabel: string;
  moreLines: string;
  actionsPrompt: string;
  hintSelect: string;
  hintConfirm: string;
  hintCancel: string;
  actionViewFull: string;
  fullViewHint: string;
  translatingNote: string;
  translatedNote: string;
  translationFailedNote: string;
  displayTranslatedNote: string;
  immuneDialogTitle: string;
}

const STRINGS: Record<Locale, Strings> = {
  en: {
    proposalHeader: "🧠 UMA • Memory Proposal",
    typeLabel: "Type",
    scopeLabel: "Scope",
    tagsLabel: "Tags",
    bodyLabel: "Content",
    actionApprove: "[Enter]  ✅  Approve & Save to Memory",
    actionEditTitle: "[e]      ✏️   Edit Title",
    actionEditBody: "[b]      📄  Edit Content (Markdown)",
    actionEditTags: "[t]      🏷️   Edit Tags",
    actionToggleScope: "[s]      🔄  Toggle Scope",
    actionReject: "[Esc]    ❌  Reject / Discard",
    actionViewFull: "[v]      📜  Full text (scrollable)",
    fullViewHint: "↑/↓ scroll · c original/Czech · Esc back",
    translatingNote: "🌐 translating for display… (the original is stored)",
    translatedNote: "🌐 display translation — the ORIGINAL is saved (c: original)",
    translationFailedNote: "🌐 translation unavailable — showing the original",
    displayTranslatedNote: "🌐 display translation — memory and CLI output unchanged",
    immuneDialogTitle: "🛡️ UMA immune interceptor",
    editPromptTitle: "Edit Title:",
    editPromptBody: "Edit Content (Markdown):",
    editPromptTags: "Edit Tags (comma-separated):",
    editInstruction: "[Enter: Save change • Esc: Cancel]",
    savedNotification: "Memory saved to UMA",
    rejectedNotification: "Memory proposal rejected",
    noFactsFound: "No facts found.",
    langUpdated: "Language updated to: ",
    cmdUsage: "Usage: /uma [search <query> | list [global] | read <id> | timeline [--id <ULID>] [--all] | export --out <dir> | doctor | lang [cs|en] | auto-approve [on|off] | recall [on|off] | judge [jev|off] — toggles accept --global]",
    searchUsage: "Usage: /uma search <query>",
    timelineUsage: "Usage: /uma timeline [--id <ULID>] [--all]",
    exportUsage: "Usage: /uma export --out <directory>",
    reindexDone: "Centralized index rebuilt successfully.",
    langCurrent: "Current language: ",
    autoApproveEnabled: "Auto-approval enabled (modal review skipped)",
    autoApproveDisabled: "Auto-approval disabled (modal review active)",
    autoApproveCurrent: "Auto-approve state: ",
    recallGateEnabled: "Fastbrain recall gate ON (memory injected only when the judge triggers)",
    recallGateDisabled: "Fastbrain recall gate OFF (recall stays explicit)",
    recallGateCurrent: "Recall gate state: ",
    recallJudgeLabel: "Judge",
    appendEnabled: "System prompt append ON (active UMA rules injected into system prompt)",
    appendDisabled: "System prompt append OFF (no rules injected into system prompt)",
    appendCurrent: "System prompt append state: ",
    compHelp: "Detailed guide and configuration documentation",
    detailedHelp: `── UMA (Universal Memory Architecture) — Guide & Configuration ──

1. ARCHITECTURE & PRINCIPLES
  • UMA is a local-first memory system for the Pi coding agent.
  • Source of truth: Human-readable Markdown files with OKF v0.2 frontmatter in .uma/ (project) and global store.
  • Search engine: Centralized SQLite FTS5 index (index.db) with hybrid RRF fusion (BM25 keywords + vector embeddings).

2. SYSTEM PROMPT ENHANCEMENT (MEMORY PRIMING)
  • /uma append on|off [--global]
    - on: Dynamically injects active architectural decisions and patterns into the model's leading system prompt (section uma_rules) before each turn. The model obeys project rules from word one without spending tool calls.
    - off: Rules are not injected automatically (default, saves context tokens).

3. COGNITIVE IMMUNE INTERCEPTOR (ARCHITECTURE GUARD)
  • /uma immune <mode> [--global]
    - off: Interceptor disabled.
    - warn: Displays warnings in TUI, never blocks tool execution.
    - ask: Displays an interactive confirmation dialog on rule breaches (default safe mode).
    - auto / block: Hard-blocks deterministic AST invariant violations (e.g. cross-slice imports).

4. FASTBRAIN RECALL GATE & JUDGE (S3 SLICE)
  • /uma recall on|off [--global]
    - on: Fastbrain evaluates prompts before the turn and recalls relevant facts conditionally.
    - off: Recall stays explicit (agent queries memory via tools only when needed).
  • /uma judge off|jev [--global]
    - off: Deterministic offline keyword heuristics (0 ms, 0 cost).
    - jev: Semantic triage via TypeSafe Jev model on OpenRouter.

5. APPROVAL MODAL & STAGING
  • /uma auto-approve on|off [--global]
    - off (recommended): Displays interactive modal review with translation toggle ('t'), word-wrapping, and vertical scrolling.
    - on: Commits memory changes automatically without modal review.
  • /uma review (or /uma staging review)
    - Interactive review modal for memory drafts captured by the Shadow Brain observer.

6. PROCEDURAL MUSCLE & INTERNAL COUNCIL
  • /uma muscle list                 — Lists operator-curated routines.
  • /uma muscle run <name> [--confirm] — Executes routine (dry-run without --confirm).
  • /uma skeptic "<intent>"          — Adversarial critique before risky mutations.
  • /uma humility on|off             — Epistemic humility gate for unfamiliar codebases.
  • /uma doctor                      — Read-only store and index health diagnostic.

Tip: Add --global to persist settings globally to ~/.pi/agent/uma.json across all sessions.`,
    immuneModeEnabled: "Immune interceptor mode updated: ",
    immuneModeCurrent: "Immune interceptor mode: ",
    immuneModeLabel: "Immune",
    hudEnabled: "UMA Detector HUD enabled",
    hudDisabled: "UMA Detector HUD disabled",
    hudCurrent: "UMA Detector HUD state: ",
    debtAutoCaptured: "📋 Cognitive debt auto-recorded from the Skeptic verdict (see /uma debt or uma_debt list)",
    debtStillOpen: "Blocking cognitive debts still open: ",
    humilityDialogTitle: "🧭 UMA epistemic humility",
    humilityGateEnabled: "Humility gate enabled (asks before mutating unfamiliar subsystems)",
    humilityGateDisabled: "Humility gate disabled",
    humilityGateCurrent: "Humility gate state: ",
    muscleDialogTitle: "⚡ UMA muscle routine",
    muscleRunConfirm: "Execute muscle routine ",
    muscleStepsLabel: "Commands to run:",
    muscleProposalStaged: "💪 Repeated command sequence detected — muscle routine proposal staged for /uma review ({name})",
    descUmaCommand: "Universal Memory Architecture (UMA) manager",
    scopeGlobal: "Global (all projects)",
    scopeProject: "Project",
    supersedesLabel: "Supersedes",
    templateLabel: "Template (not executed)",
    staleAfterLabel: "Valid until (re-verify after)",
    sinceLabel: "Valid from",
    noTags: "(no tags)",
    titleLabel: "Title",
    moreLines: "+{n} more lines",
    actionsPrompt: "Choose an action:",
    hintSelect: "select",
    hintConfirm: "confirm",
    hintCancel: "cancel",
  },
  cs: {
    proposalHeader: "🧠 UMA • Návrh zápisu do paměti",
    typeLabel: "Typ",
    scopeLabel: "Rozsah",
    tagsLabel: "Tagy",
    bodyLabel: "Obsah",
    actionApprove: "[Enter]  ✅  Schválit a uložit do paměti",
    actionEditTitle: "[e]      ✏️   Upravit název",
    actionEditBody: "[b]      📄  Upravit obsah (Markdown)",
    actionEditTags: "[t]      🏷️   Upravit tagy",
    actionToggleScope: "[s]      🔄  Přepnout rozsah",
    actionReject: "[Esc]    ❌  Zamítnout a zahodit",
    actionViewFull: "[v]      📜  Celý text (s rolováním)",
    fullViewHint: "↑/↓ rolovat · c originál/česky · Esc zpět",
    translatingNote: "🌐 překládám pro zobrazení… (ukládá se originál)",
    translatedNote: "🌐 zobrazený překlad — ukládá se ORIGINÁL (c: originál)",
    translationFailedNote: "🌐 překlad nedostupný — zobrazuje se originál",
    displayTranslatedNote: "🌐 zobrazený překlad — pamět i výstup CLI se nemění",
    immuneDialogTitle: "🛡️ UMA imunní interceptor",
    editPromptTitle: "Upravit název:",
    editPromptBody: "Upravit obsah (Markdown):",
    editPromptTags: "Upravit tagy (oddělené čárkou):",
    editInstruction: "[Enter: Uložit změnu • Esc: Zpět]",
    savedNotification: "Záznam byl uložen do UMA",
    rejectedNotification: "Návrh paměti byl zamítnut",
    noFactsFound: "Nebyly nalezeny žádné záznamy.",
    langUpdated: "Jazyk rozhraní nastaven na: ",
    cmdUsage: "Použití: /uma [search <dotaz> | list [global] | read <id> | timeline [--id <ULID>] [--all] | export --out <složka> | doctor | lang [cs|en] | auto-approve [on|off] | recall [on|off] | judge [jev|off] — přepínače akceptují --global]",
    searchUsage: "Použití: /uma search <dotaz>",
    timelineUsage: "Použití: /uma timeline [--id <ULID>] [--all]",
    exportUsage: "Použití: /uma export --out <složka>",
    reindexDone: "Centralizovaný index byl úspěšně přebudován.",
    langCurrent: "Aktuální jazyk: ",
    autoApproveEnabled: "Automatické schvalování zapnuto (modální okno se nezobrazuje)",
    autoApproveDisabled: "Automatické schvalování vypnuto (modální okno je aktivní)",
    autoApproveCurrent: "Stav automatického schvalování: ",
    recallGateEnabled: "Recallová brána ZAPNUTÁ (paměť se injektuje jen při triggeru)",
    recallGateDisabled: "Recallová brána VYPNUTÁ (recall zůstává explicitní)",
    recallGateCurrent: "Stav recallové brány: ",
    recallJudgeLabel: "Soudce",
    appendEnabled: "Připojování pravidel do system promptu ZAPNUTO (aktivní UMA pravidla v promptu)",
    appendDisabled: "Připojování pravidel do system promptu VYPNUTO",
    appendCurrent: "Stav připojování pravidel do system promptu: ",
    compHelp: "Podrobná česká nápověda a popis všech nastavení",
    detailedHelp: `── UMA (Universal Memory Architecture) — Nápověda a konfigurace ──

1. ZÁKLADNÍ ARCHITEKTURA A PRINCIP
  • UMA je lokální paměťový systém pro Pi coding agenta.
  • Zdroj pravdy: Lidsky čitelné Markdown soubory s hlavičkou OKF v0.2 v .uma/ (projekt) a v uživatelském profilu (globální).
  • Rychlé vyhledávání: Centralizovaný SQLite index (index.db) s hybridním vyhledáváním (BM25 klíčová slova + sémantické vektory).

2. PŘIPOJOVÁNÍ PRAVIDEL DO SYSTEM PROMPTU (MEMORY PRIMING)
  • /uma append on|off [--global]
    - on: Před každým tahem vloží aktivní architektonická rozhodnutí a vzory projektu přímo do systémového promptu modelu (sekce uma_rules). Model pravidla dodržuje ihned bez volání nástrojů.
    - off: Pravidla se do promptu automaticky nepřipojují (výchozí stav, šetří kontext).

3. KOGNITIVNÍ IMUNITNÍ SYSTÉM (OCHRANA ARCHITEKTURY)
  • /uma immune <režim> [--global]
    - off: Imunitní interceptor je vypnutý.
    - warn: Pouze zobrazuje varování v TUI, nikdy neblokuje kód.
    - ask: Při dotyku chráněného pravidla zobrazí potvrzovací dialog (výchozí bezpečný režim).
    - auto / block: Deterministicky zablokuje pokus o porušení AST kontraktu (např. zakázaný cross-slice import).

4. RECALLOVÁ BRÁNA A SOUDCE (FASTBRAIN S3)
  • /uma recall on|off [--global]
    - on: Fastbrain před spuštěním agenta vyhodnotí dotaz a automaticky přitáhne relevantní fakta.
    - off: Recall zůstává explicitní (agent volá uma_search pouze když sám potřebuje).
  • /uma judge off|jev [--global]
    - off: Deterministické lokální markery (0 ms, 0 Kč, funguje offline).
    - jev: Sémantické hodnocení přes model TypeSafe Jev na OpenRouteru.

5. SCHVALOVÁNÍ ZÁPISŮ A STAGING
  • /uma auto-approve on|off [--global]
    - off (doporučeno): Každý návrh na zápis či změnu paměti zobrazí interaktivní modální okno s překladem do češtiny (klávesa 't'), zalamováním a rolováním.
    - on: Ukládá fakta do paměti bez potvrzování.
  • /uma review (nebo /uma staging review)
    - Otevře interaktivní okno pro kontrolu a schválení konceptů zachycených pozorovatelem na pozadí (Shadow Brain).

6. SVALOVÁ PAMĚŤ A VNITŘNÍ RADA
  • /uma muscle list                 — Zobrazí kurátorské rutiny.
  • /uma muscle run <název> [--confirm] — Spustí rutinu (bez --confirm bezpečný dry-run).
  • /uma skeptic "<záměr>"           — Oponent před rizikovou architektonickou změnou.
  • /uma humility on|off             — Vyžaduje prozkoumání neznámého subsystému před mutací.
  • /uma doctor                      — Čtecí kontrola zdraví storu a indexu.

Tip: Přidejte přepínač --global pro trvalé uložení do ~/.pi/agent/uma.json (platí pro všechny projekty).`,
    immuneModeEnabled: "Režim imunního interceptoru nastaven: ",
    immuneModeCurrent: "Režim imunního interceptoru: ",
    immuneModeLabel: "Imunita",
    hudEnabled: "Detektor UMA HUD zapnut",
    hudDisabled: "Detektor UMA HUD vypnut",
    hudCurrent: "Stav detektoru UMA HUD: ",
    debtAutoCaptured: "📋 Kognitivní dluh automaticky zapsán z verdiktu Skeptika (viz /uma debt nebo uma_debt list)",
    debtStillOpen: "Otevřené blokující kognitivní dluhy: ",
    humilityDialogTitle: "🧭 UMA epistemická pokora",
    humilityGateEnabled: "Brána pokory zapnuta (ptá se před zásahem do neznámých subsystémů)",
    humilityGateDisabled: "Brána pokory vypnuta",
    humilityGateCurrent: "Stav brány pokory: ",
    muscleDialogTitle: "⚡ UMA svalová rutina",
    muscleRunConfirm: "Spustit svalovou rutinu ",
    muscleStepsLabel: "Příkazy ke spuštění:",
    muscleProposalStaged: "💪 Detekována opakovaná sekvence příkazů — návrh rutiny staged pro /uma review ({name})",
    descUmaCommand: "Správa paměťového systému UMA",
    scopeGlobal: "Globální (všechny projekty)",
    scopeProject: "Projekt",
    supersedesLabel: "Nahrazuje",
    templateLabel: "Šablona (nespouští se)",
    staleAfterLabel: "Platí do (poté znovu ověřit)",
    sinceLabel: "Platí od",
    noTags: "(žádné tagy)",
    titleLabel: "Název",
    moreLines: "+{n} řádků",
    actionsPrompt: "Vyberte akci:",
    hintSelect: "vybrat",
    hintConfirm: "potvrdit",
    hintCancel: "zrušit",
  },
};

export function normalizeLocale(raw: string | undefined): Locale {
  const token = (raw ?? "").trim().toLowerCase();
  if (token === "cs" || token === "cz" || token === "cze") return "cs";
  return "en";
}

export function stringsFor(locale: string | undefined): Strings {
  return STRINGS[normalizeLocale(locale)];
}

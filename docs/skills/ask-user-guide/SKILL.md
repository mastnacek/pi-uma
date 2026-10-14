---
name: ask-user-guide
description: Guide for when and how to use the ask_user_question tool to prompt the user with structured choices during execution.
---

# Ask User Guide Skill

> **Purpose**: Teach the agent **when** to interrupt execution and ask the user for decisions, and **how** to structure effective questions using the `ask_user_question` tool.

---

## When to Use `ask_user_question`

Use this tool **whenever you cannot proceed without a concrete decision from the operator**. Do not guess, assume, or pick a default.

### Mandatory Triggers

| Situation | Example |
|-----------|---------|
| **Architectural choice** | "Should this be a Rust CLI or a TypeScript Pi plugin?" |
| **Library/framework selection** | "FastAPI vs Axum for the backend?" |
| **Trade-off with no clear winner** | "Optimize for latency or memory?" |
| **Breaking change / migration** | "Supersede the old memory fact or keep both?" |
| **User preference unknown** | "Czech or English for the output?" |
| **Scope ambiguity** | "Global UMA store or project-scoped?" |
| **Risk acceptance** | "This may delete staging drafts — proceed?" |
| **Multi-option with preview** | "Which UI layout? (shows ASCII mockups)" |

### Do NOT Use For

- **Trivial preferences** the operator already stated (check UMA memory first)
- **Implementation details** you can decide (naming, formatting, internal structure)
- **Yes/no confirmations** that are obvious — just proceed or use a simple `ctx.ui.confirm`
- **Stacked questions** — batch all clarifications into **one invocation** (max 4 questions)

---

## How to Structure Questions

### Basic Template (Copy This)

```typescript
await ask_user_question({
  questions: [
    {
      question: "Which library should we use for date formatting?",
      header: "Date Lib",
      options: [
        {
          label: "date-fns (Recommended)",
          description: "Lightweight, modular, tree-shakeable, excellent TypeScript support",
          preview: "```ts\nimport { format } from 'date-fns';\nformat(new Date(), 'yyyy-MM-dd');\n```"
        },
        {
          label: "dayjs",
          description: "Moment.js API, smaller bundle, mutable by default",
          preview: "```ts\nimport dayjs from 'dayjs';\ndayjs().format('YYYY-MM-DD');\n```"
        },
        {
          label: "Luxon",
          description: "Rich API, built-in Intl, immutable, heavier",
          preview: "```ts\nimport { DateTime } from 'luxon';\nDateTime.now().toISODate();\n```"
        }
      ]
    }
  ]
});
```

### Rules (Enforced at Runtime)

| Rule | Enforcement |
|------|-------------|
| 1–4 questions per call | Schema validation |
| 2–4 options per question | Schema validation |
| Label ≤ 60 chars | Runtime reject |
| Header ≤ 16 chars | Runtime reject |
| No "Other" / "Type something" labels | Reserved — auto-appended |
| `preview` only for single-select | Runtime reject if `multiSelect: true` |
| `multiSelect: true` only when multiple valid | Guideline |

### Option Design

| Element | Purpose | Example |
|---------|---------|---------|
| **label** | Concise outcome name (1–5 words) | `"FastAPI (Recommended)"` |
| **description** | Trade-offs, implications | `"Auto OpenAPI, async, type-safe"` |
| **preview** | Visual comparison (mockup, code, diagram) | ASCII UI, config snippet, diagram |

**Recommendation**: Put your recommended option **first** with `"(Recommended)"` suffix.

---

## Decision Patterns (Common Scenarios)

### 1. Library/Framework Choice
```json
{
  "question": "Which HTTP framework for the new service?",
  "header": "HTTP Framework",
  "options": [
    { "label": "FastAPI (Recommended)", "description": "Auto OpenAPI, Pydantic, async native" },
    { "label": "Axum", "description": "Rust, tower ecosystem, high performance" },
    { "label": "Hono", "description": "Lightweight, edge-ready, Web Standard APIs" }
  ]
}
```

### 2. Architecture Pattern
```json
{
  "question": "How should we structure the new feature?",
  "header": "Structure",
  "options": [
    { "label": "VSA Slice (Recommended)", "description": "Isolated feature slice per capability, shared kernel" },
    { "label": "Layered (Controller/Service/Repo)", "description": "Traditional separation, easier for teams unfamiliar with VSA" },
    { "label": "Modular Monolith", "description": "Explicit module boundaries, single deployable" }
  ]
}
```

### 3. Data/Schema Decision
```json
{
  "question": "How to represent the invoice line item schema?",
  "header": "Schema",
  "options": [
    { "label": "Pydantic + JSON Schema (Recommended)", "description": "Validation + auto-docs, Python-native" },
    { "label": "TypeBox + TypeScript", "description": "Type-safe runtime validation, Pi-compatible" },
    { "label": "Protocol Buffers", "description": "Compact binary, schema evolution, multi-language" }
  ]
}
```

### 4. Risk/Consent Gate
```json
{
  "question": "The migration will supersede 47 memory facts. This cannot be undone automatically. Proceed?",
  "header": "Confirm",
  "options": [
    { "label": "Yes, supersede all", "description": "Old facts marked deprecated, new facts chain via supersedes" },
    { "label": "No, keep both", "description": "New facts written alongside old; manual cleanup later" },
    { "label": "Review first", "description": "Show me the diff of each supersession before deciding" }
  ]
}
```

### 5. Multi-Select (Multiple Valid Choices)
```json
{
  "question": "Which platforms should the build target?",
  "header": "Platforms",
  "multiSelect": true,
  "options": [
    { "label": "Linux x64", "description": "Primary CI target" },
    { "label": "Windows x64", "description": "Operator's daily driver" },
    { "label": "macOS ARM64", "description": "Future-proofing" },
    { "label": "WASM", "description": "Browser/web embedding" }
  ]
}
```

### 6. Preview for Visual Comparison
```json
{
  "question": "Which TUI layout for the detector HUD?",
  "header": "HUD Layout",
  "options": [
    {
      "label": "Compact horizontal (Recommended)",
      "description": "Single line, fits narrow terminals",
      "preview": "```\n🧠 UMA v0.4.0 [bundled] │ 🛡️ immune:warn (3) │ ⚡ recall:on [jev] │ 🔒 gate:modal │ 📁 pi-uma (42) │ ✦ 2 drafts\n```"
    },
    {
      "label": "Expanded vertical",
      "description": "Multi-line, more detail per module",
      "preview": "```\n🧠 UMA v0.4.0 [bundled]\n🛡️ immune:warn (3 contracts)\n⚡ recall:on [jev]\n🔒 gate:modal\n📁 project:pi-uma (42 facts)\n✦ 2 drafts\n```"
    }
  ]
}
```

---

## UMA Memory Integration

**Before asking**, check UMA for existing preferences:

```typescript
// Search for past decisions
const prefs = await uma_search({
  query: "preferred HTTP framework",
  type: "preference",
  scope: "global"
});

// If found, USE IT — don't ask again
if (prefs.length > 0) {
  // Apply the stored preference
}
```

**After the user answers**, store the decision:

```typescript
await uma_write({
  title: "HTTP framework choice for invoice service",
  body: `## Decision\nSelected FastAPI for the invoice extraction service.\n\n## Reasoning\n- Auto OpenAPI docs\n- Pydantic validation matches our schema-first approach\n- Team familiarity\n\n## Consequences\n- All new services follow this pattern unless superseded`,
  type: "decision",
  scope: "project:invoice-extractor",
  tags: ["architecture", "http", "fastapi"]
});
```

---

## Hook Integration (Optional)

If you want **automatic prompting** at specific points, add a hook in your extension:

```typescript
// In your extension's index.ts or a slice
import { ASK_USER_QUESTION_TOOL_NAME } from "pi-ask-user-cz";

pi.on("before_agent_start", async (event, ctx) => {
  // Example: Auto-ask if task matches certain patterns
  if (event.prompt.includes("migrate") && !event.prompt.includes("--yes")) {
    // The agent will see this and can choose to call ask_user_question
    // Or you could emit a custom event that your skill listens for
  }
});
```

But **prefer explicit agent calls** — the agent decides when it's blocked.

---

## Quick Reference Card

| Need | Question Template | Options |
|------|-------------------|---------|
| Pick one | "Which X should we use?" | 2–4 labeled options |
| Pick multiple | "Which X apply?" | `multiSelect: true` |
| Visual compare | "Which layout?" | `preview` on each |
| Risk gate | "Proceed with X?" | Yes / No / Review |
| Confirm detail | "Should X be Y?" | Yes / No / Custom |

---

## Installation

This skill documents the `ask_user_question` tool from `pi-ask-user-cz`.

```bash
# Ensure the plugin is installed (provides the tool)
pi install git:github.com/mastnacek/pi-ask-user-cz

# Load this skill
/skill ask-user-guide
```

---

## Tags

:guide:ask-user:question:tool:pi-ask-user-cz:decision:prompt:
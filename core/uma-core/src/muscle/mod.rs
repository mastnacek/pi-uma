//! Procedural muscle memory: compiled action chunks (Proposal 05, Pillar I).
//!
//! The agent states only a motor intent (`uma muscle run verify_slice`); the
//! native Rust runtime executes the operator-curated step sequence locally —
//! no LLM calls, no gaps, a fraction of the tokens and latency.
//!
//! **Consent model (amends "skills expand, never execute" `01M4DGRW9Q85PXXE11G9NA0BWQ`):**
//! - Routines are **operator-curated only**: they live as `skill` facts whose
//!   template is a YAML/JSON step list. The shadow worker may only *propose*
//!   a new routine through staging — never compile or run one by itself.
//! - Execution requires the explicit `--confirm` flag (the launch-time consent
//!   step, same pattern as MCP's `--allow-writes`): without it, `run` is a
//!   dry-run that only prints what would execute.
//! - Steps run sequentially in the repo root; the first failing step stops the
//!   pass and its output is reported as the failure.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::domain::{Fact, FactType, Scope};
use crate::store::Store;

#[cfg(test)]
mod tests;

/// One step of a compiled routine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MuscleStep {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Optional human label shown in the summary.
    #[serde(default)]
    pub label: Option<String>,
}

/// A compiled routine: a name plus its step sequence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MuscleRoutine {
    pub name: String,
    pub steps: Vec<MuscleStep>,
    /// Source skill fact id, for provenance.
    #[serde(default)]
    pub fact_id: Option<String>,
}

/// One executed step's outcome.
#[derive(Debug, Clone, Serialize)]
pub struct StepResult {
    pub label: String,
    pub command: String,
    pub exit_code: i32,
    pub success: bool,
    pub output_tail: String,
}

/// The pass's compressed summary (what the agent reads instead of 1000 tokens).
#[derive(Debug, Clone, Serialize)]
pub struct MuscleReport {
    pub routine: String,
    pub steps_run: usize,
    pub steps_total: usize,
    pub success: bool,
    pub steps: Vec<StepResult>,
    pub summary: String,
    pub dry_run: bool,
}

/// Parses a routine's steps from a skill fact's template.
///
/// The template is either JSON or YAML in the simplified "list of
/// {command, args?, label?}" shape — data only, parsed with serde_json first
/// and a minimal YAML mapping fallback.
pub fn parse_routine(name: &str, template: &str) -> Result<MuscleRoutine> {
    let trimmed = template.trim();
    let json_parse: Result<Vec<MuscleStep>, _> = serde_json::from_str(trimmed);
    let steps = match json_parse {
        Ok(steps) => steps,
        Err(_) => parse_yaml_steps(trimmed)?,
    };
    if steps.is_empty() {
        anyhow::bail!("Routine '{name}' has no steps");
    }
    for step in &steps {
        if step.command.trim().is_empty() {
            anyhow::bail!("Routine '{name}' has an empty command");
        }
    }
    Ok(MuscleRoutine {
        name: name.to_string(),
        steps,
        fact_id: None,
    })
}

/// Minimal YAML step-list parser for the flat {command, args, label} shape.
fn parse_yaml_steps(trimmed: &str) -> Result<Vec<MuscleStep>> {
    let mut steps = Vec::new();
    let mut current: Option<MuscleStep> = None;
    for line in trimmed.lines() {
        let line = line.trim_end();
        if line.trim_start().starts_with("- command:") {
            if let Some(prev) = current.take() {
                steps.push(prev);
            }
            current = Some(MuscleStep {
                command: line
                    .split_once(':')
                    .map(|(_, v)| v.trim().trim_matches(['"', '\'']).to_string())
                    .unwrap_or_default(),
                args: Vec::new(),
                label: None,
            });
        } else if line.trim_start().starts_with("- ") {
            // plain "- command args" list item
            if let Some(prev) = current.take() {
                steps.push(prev);
            }
            let raw = line.trim_start()[2..].trim().trim_matches(['"', '\'']).to_string();
            let mut parts = raw.split_whitespace();
            let command = parts.next().context("Empty routine step")?.to_string();
            current = Some(MuscleStep {
                command,
                args: parts.map(String::from).collect(),
                label: None,
            });
        } else if line.trim_start().starts_with("args:") {
            if let Some(ref mut step) = current {
                let raw = line.split_once(':').map(|(_, v)| v.trim()).unwrap_or("");
                step.args = raw
                    .split(',')
                    .map(|a| a.trim().trim_matches(['"', '\'']).to_string())
                    .filter(|a| !a.is_empty())
                    .collect();
            }
        } else if line.trim_start().starts_with("label:") {
            if let Some(ref mut step) = current {
                step.label = Some(
                    line.split_once(':')
                        .map(|(_, v)| v.trim().trim_matches(['"', '\'']).to_string())
                        .unwrap_or_default(),
                );
            }
        }
    }
    if let Some(prev) = current.take() {
        steps.push(prev);
    }
    Ok(steps)
}

/// Finds an operator-curated routine: a `skill` fact titled `muscle:<name>`
/// (or whose tags contain `muscle` and the name) in project or global scope.
pub fn find_routine(store_hint: Option<&Store>, name: &str) -> Result<MuscleRoutine> {
    let wanted = format!("muscle:{name}");
    let mut roots: Vec<PathBuf> = Vec::new();

    if let Some(project) = Store::current_project_name() {
        if let Ok(store) = Store::project(project) {
            roots.push(store.root.clone());
        }
    }
    if let Ok(global) = Store::global() {
        roots.push(global.root.clone());
    }
    if let Some(hint) = store_hint {
        roots.push(hint.root.clone());
    }

    for root in &roots {
        for fact in walk_skills(root)? {
            // A superseded routine keeps its muscle tag on disk (deprecated,
            // never deleted) — without this filter the retired revision could
            // win the walk order and silently run the old step list.
            if !fact.is_active_at(chrono::Utc::now()) {
                continue;
            }
            let routine_name = fact.title.strip_prefix("muscle:").unwrap_or(&fact.title);
            let name_matches = routine_name.eq_ignore_ascii_case(name)
                || fact.tags.iter().any(|t| t.eq_ignore_ascii_case(&wanted));
            if !name_matches || fact.template.is_none() {
                continue;
            }
            let mut routine = parse_routine(name, fact.template.as_deref().unwrap())?;
            routine.fact_id = Some(fact.id.to_string());
            return Ok(routine);
        }
    }

    anyhow::bail!(
        "No operator-curated muscle routine '{name}' (a skill fact tagged muscle with a step template). Curate one with `uma skill new`."
    )
}

fn walk_skills(root: &Path) -> Result<Vec<Fact>> {
    let mut facts = Vec::new();
    let skill_dir = root.join(FactType::Skill.dir_name());
    if !skill_dir.exists() {
        return Ok(facts);
    }
    for entry in walkdir::WalkDir::new(&skill_dir).into_iter().flatten() {
        if entry.file_type().is_file() && entry.path().extension().is_some_and(|e| e == "md") {
            if let Ok(content) = std::fs::read_to_string(entry.path()) {
                if let Ok(fact) = crate::serialization::markdown_to_fact(&content) {
                    facts.push(fact);
                }
            }
        }
    }
    Ok(facts)
}

/// Executes (or dry-runs) a routine in `workdir`.
pub fn run_routine(routine: &MuscleRoutine, workdir: &Path, confirm: bool) -> Result<MuscleReport> {
    if !confirm {
        // Dry-run: print the sequence, execute nothing.
        let steps: Vec<String> = routine
            .steps
            .iter()
            .map(|s| format!("{} {}", s.command, s.args.join(" ")))
            .collect();
        return Ok(MuscleReport {
            routine: routine.name.clone(),
            steps_run: 0,
            steps_total: routine.steps.len(),
            success: true,
            steps: Vec::new(),
            summary: format!(
                "DRY-RUN would execute:\n{}",
                steps.iter().map(|s| format!("  $ {s}")).collect::<Vec<_>>().join("\n")
            ),
            dry_run: true,
        });
    }

    let mut results = Vec::new();
    for step in &routine.steps {
        let output = Command::new(&step.command)
            .args(&step.args)
            .current_dir(workdir)
            .output()
            .with_context(|| format!("Failed to execute {}", step.command))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let mut tail: String = format!("{stdout}{stderr}").lines().rev().take(5).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
        if tail.len() > 400 {
            tail = tail.chars().rev().take(400).collect::<String>().chars().rev().collect();
        }

        let result = StepResult {
            label: step.label.clone().unwrap_or_else(|| step.command.clone()),
            command: format!("{} {}", step.command, step.args.join(" ")),
            exit_code: output.status.code().unwrap_or(-1),
            success: output.status.success(),
            output_tail: tail,
        };
        let success = result.success;
        results.push(result);
        if !success {
            break; // first failure stops the pass
        }
    }

    let steps_run = results.len();
    let success = steps_run == routine.steps.len() && results.last().map(|r| r.success).unwrap_or(false);
    let summary = if success {
        format!(
            "✓ {} step(s) OK: {} — ready.",
            steps_run,
            results.iter().map(|r| r.label.as_str()).collect::<Vec<_>>().join(", ")
        )
    } else {
        let failed = results.last().map(|r| format!("{} (exit {})", r.label, r.exit_code)).unwrap_or_default();
        format!("✗ stopped at step {steps_run}/{}: {failed}", routine.steps.len())
    };

    Ok(MuscleReport {
        routine: routine.name.clone(),
        steps_run,
        steps_total: routine.steps.len(),
        success,
        steps: results,
        summary,
        dry_run: false,
    })
}

/// Creates an operator-curated routine as a `skill` fact through the gated write path.
pub fn curate_routine(name: &str, template: &str, scope: Scope, description: Option<String>) -> Result<Fact> {
    // Validate the template parses BEFORE storing, so a typo never becomes memory.
    parse_routine(name, template)?;

    let mut fact = Fact::new(
        scope,
        FactType::Skill,
        format!("muscle:{name}"),
        format!("Operator-curated muscle routine '{name}'. Steps are data; execution requires explicit --confirm consent."),
    );
    fact.description = description;
    fact.template = Some(template.to_string());
    fact.tags = vec!["muscle".to_string(), "routine".to_string()];
    Ok(fact)
}
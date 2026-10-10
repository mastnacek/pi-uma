//! Route: System-1 task routing verdicts (Proposal 09, Fáze A).
//!
//! **Read-only.** Answers one question — *which specialist (scope / future
//! herdr pane) should receive this prompt?* — and never delegates. The
//! verdict crosses the process boundary as JSON or text; the orchestrator's
//! pi plugin is the only component allowed to execute `herdr` commands.
//!
//! Candidates come from the central index's known scopes: each scope becomes
//! a [`Specialist`] whose keywords are its name tokens. A confident verdict
//! also recalls up to `--max` facts from the winning scope as the handoff's
//! context slice — the priming the delegate pane starts with.

use anyhow::Result;
use clap::{Args, Subcommand};
use serde_json::json;
use uma_core::domain::Scope;
use uma_core::fastbrain::route::{route_task, Specialist};
use uma_core::fastbrain::Judge;
use uma_core::search::SearchMode;
use uma_core::store::Store;

#[derive(Args, Debug, Clone)]
pub struct RouteArgs {
    #[command(subcommand)]
    pub command: RouteCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub enum RouteCommand {
    /// Check which specialist a prompt routes to (read-only; never delegates)
    Check(CheckArgs),
}

#[derive(Args, Debug, Clone)]
pub struct CheckArgs {
    /// The prompt to route (joined if several arguments are given)
    pub prompt: Vec<String>,

    /// Which judge to use: off (default) or jev (Fáze D; degrades to offline)
    #[arg(long = "judge", default_value = "off", value_parser = ["off", "jev"])]
    pub judge: String,

    /// Maximum facts recalled into the winner's context slice
    #[arg(long = "max", default_value_t = 3)]
    pub max: usize,

    /// Emit the verdict as JSON
    #[arg(long = "json")]
    pub json: bool,
}

/// Executes the Route vertical slice.
pub fn run(args: RouteArgs) -> Result<()> {
    match args.command {
        RouteCommand::Check(check) => check_route(check),
    }
}

fn check_route(args: CheckArgs) -> Result<()> {
    if args.prompt.is_empty() {
        anyhow::bail!("Nothing to route: pass the prompt text");
    }
    let prompt = args.prompt.join(" ");

    let summaries = Store::known_scopes()?;
    let candidates: Vec<Specialist> = summaries
        .iter()
        .map(|summary| Specialist::from_scope_name(summary.scope.dir_name()))
        .collect();

    let judge = match args.judge.as_str() {
        "jev" => Judge::Jev,
        _ => Judge::Offline,
    };
    let judgment = route_task(&prompt, &candidates, judge)
        .map_err(|failure| anyhow::anyhow!("Route check failed: {failure}"))?;
    let verdict = &judgment.answer;

    // A confident route earns its handoff: recall the winning scope's
    // relevant facts so the delegate pane starts warm.
    let context_slice = match &verdict.specialist {
        Some(name) => match scope_by_dir_name(&summaries, name) {
            Some(scope) => recall_context_slice(&prompt, &scope, args.max)?,
            None => Vec::new(),
        },
        None => Vec::new(),
    };

    if args.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({
                "specialist": verdict.specialist,
                "runner_up": verdict.runner_up,
                "confidence": judgment.confidence,
                "judged_by": judgment.judged_by.as_str(),
                "scores": verdict.scores,
                "context_slice": context_slice,
                "note": judgment.notes,
            }))?
        );
        return Ok(());
    }

    match &verdict.specialist {
        Some(name) => {
            println!(
                "Route: {} (judge {}, confidence {:.2})",
                name,
                judgment.judged_by.as_str(),
                judgment.confidence
            );
            if !context_slice.is_empty() {
                println!("Context slice for the handoff:");
                for (idx, fact) in context_slice.iter().enumerate() {
                    println!(
                        "  {}. [{}] {} — {}",
                        idx + 1,
                        fact["fact_type"].as_str().unwrap_or("?"),
                        fact["title"].as_str().unwrap_or("?"),
                        fact["id"].as_str().unwrap_or("?")
                    );
                }
            }
        }
        None => {
            println!(
                "No confident route (judge {}, best score {:.2}) — escalate to the orchestrator.",
                judgment.judged_by.as_str(),
                judgment.confidence
            );
            if let Some(ref runner_up) = verdict.runner_up {
                println!("Closest candidate: {runner_up}");
            }
        }
    }
    if let Some(ref note) = judgment.notes {
        println!("note: {note}");
    }
    Ok(())
}

/// Resolves a routed dir_name back to its real scope (`global` is Global,
/// everything else is the project of that name).
fn scope_by_dir_name(
    summaries: &[uma_core::store::ScopeSummary],
    dir_name: &str,
) -> Option<Scope> {
    summaries
        .iter()
        .find(|summary| summary.scope.dir_name() == dir_name)
        .map(|summary| summary.scope.clone())
}

/// Recalls facts inside the winning scope as the delegate's priming slice.
fn recall_context_slice(
    prompt: &str,
    scope: &Scope,
    max: usize,
) -> Result<Vec<serde_json::Value>> {
    let query: String = prompt
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| word.chars().count() > 2)
        .take(12)
        .collect::<Vec<_>>()
        .join(" ");
    let outcome = Store::search_all(
        &query,
        Some(scope),
        None,
        SearchMode::Keyword,
        false,
        None,
        max,
    )?;
    Ok(outcome
        .hits
        .iter()
        .map(|hit| {
            json!({
                "id": hit.id,
                "title": hit.title,
                "fact_type": hit.fact_type,
                "score": hit.score,
                "tags": hit.tags,
            })
        })
        .collect())
}

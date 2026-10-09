//! Humility: the Familiarity Index as a user-visible surface (Proposal 04, Pillar IV).
//!
//! **Read-only and on-demand.** Gathering is the slice's job (memory coverage of
//! the target files across all fact types); judging is the council's. The verdict
//! recommends Read-Only Explorative Mode for low-familiarity subsystems; it never
//! blocks by itself.

use anyhow::Result;
use clap::{Args, Subcommand};
use uma_core::council::{assess_familiarity, HumilityInput};
use uma_core::domain::Scope;
use uma_core::fastbrain::Judge;
use uma_core::store::Store;

#[derive(Args, Debug, Clone)]
pub struct HumilityArgs {
    #[command(subcommand)]
    pub command: HumilityCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub enum HumilityCommand {
    /// Assess the Familiarity Index for a proposed intervention (read-only)
    Check(CheckArgs),
}

#[derive(Args, Debug, Clone)]
pub struct CheckArgs {
    /// The intent the agent plans to execute
    pub intent: Vec<String>,

    /// Files the intent will touch (comma-separated)
    #[arg(long = "files", value_delimiter = ',')]
    pub files: Vec<String>,

    /// Which judge to use: jev (default) or off
    #[arg(long = "judge", default_value = "jev", value_parser = ["off", "jev"])]
    pub judge: String,

    /// Emit the verdict as JSON
    #[arg(long = "json")]
    pub json: bool,
}

/// Executes the Humility vertical slice.
pub fn run(args: HumilityArgs) -> Result<()> {
    match args.command {
        HumilityCommand::Check(check) => check_familiarity(check),
    }
}

fn check_familiarity(args: CheckArgs) -> Result<()> {
    let intent = args.intent.join(" ");
    if intent.trim().is_empty() {
        anyhow::bail!("Nothing to assess: pass the intent text");
    }

    let coverage = fact_coverage(&args.files)?;
    let input = HumilityInput {
        intent,
        files: args.files.clone(),
        fact_coverage: coverage,
    };

    let judge = match args.judge.as_str() {
        "jev" => Judge::Jev,
        _ => Judge::Offline,
    };

    let verdict = assess_familiarity(&input, judge)
        .map_err(|e| anyhow::anyhow!("Humility assessment failed: {e}"))?;

    if args.json {
        println!(
            "{}",
            serde_json::json!({
                "familiarity": verdict.familiarity.as_str(),
                "fact_coverage": verdict.fact_coverage,
                "complexity_signals": verdict.complexity_signals,
                "exploration_required": verdict.exploration_required,
                "hypothesis_required": verdict.hypothesis_required,
                "advice": verdict.advice,
                "judged_by": verdict.judged_by.as_str(),
                "notes": verdict.notes,
            })
        );
        return Ok(());
    }

    println!(
        "Familiarity Index ({}): {} · coverage: {} fact(s){}",
        verdict.judged_by.as_str(),
        verdict.familiarity.as_str(),
        verdict.fact_coverage,
        if verdict.complexity_signals.is_empty() {
            String::new()
        } else {
            format!(" · signals: {}", verdict.complexity_signals.join(", "))
        }
    );
    println!("  {}", verdict.advice);
    if verdict.exploration_required {
        println!("  ⚠ Read-Only Explorative Mode: read ≥3 related files, state a hypothesis, then mutate.");
    }
    if let Some(ref note) = verdict.notes {
        println!("  note: {note}");
    }
    Ok(())
}

/// Counts memory facts (any type, both scopes) mentioning any target file path or stem.
fn fact_coverage(files: &[String]) -> Result<usize> {
    let tokens: Vec<String> = files
        .iter()
        .flat_map(|f| {
            let p = std::path::Path::new(f);
            let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or_default().to_string();
            [f.replace('\\', "/"), stem]
        })
        .filter(|t| !t.is_empty())
        .collect();

    if tokens.is_empty() {
        return Ok(0);
    }

    let mut count = 0usize;
    for facts in all_facts()? {
        for fact in facts {
            let haystack = format!("{} {}", fact.title, fact.body).replace('\\', "/");
            if tokens.iter().any(|token| haystack.contains(token.as_str())) {
                count += 1;
            }
        }
    }
    Ok(count)
}

fn all_facts() -> Result<Vec<Vec<uma_core::domain::Fact>>> {
    let mut out = Vec::new();
    if let Some(project) = Store::current_project_name() {
        if let Ok(store) = Store::project(project.clone()) {
            if let Ok(facts) = store.list(&Scope::Project(project), None) {
                out.push(facts);
            }
        }
    }
    if let Ok(global) = Store::global() {
        if let Ok(facts) = global.list(&Scope::Global, None) {
            out.push(facts);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[derive(Parser, Debug)]
    struct TestCli {
        #[command(subcommand)]
        command: HumilityCommand,
    }

    #[test]
    fn test_humility_check_args_parsing() {
        let cli = TestCli::try_parse_from([
            "test",
            "check",
            "rewrite",
            "the",
            "macros",
            "--files",
            "src/macros/expand.rs",
            "--judge",
            "off",
            "--json",
        ])
        .unwrap();
        let HumilityCommand::Check(args) = cli.command;
        assert_eq!(args.intent.join(" "), "rewrite the macros");
        assert_eq!(args.files, vec!["src/macros/expand.rs"]);
        assert_eq!(args.judge, "off");
        assert!(args.json);
    }

    #[test]
    fn test_humility_check_defaults_to_jev() {
        let cli = TestCli::try_parse_from(["test", "check", "intent"]).unwrap();
        let HumilityCommand::Check(args) = cli.command;
        assert_eq!(args.judge, "jev");
    }
}
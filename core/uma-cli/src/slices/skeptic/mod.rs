//! Skeptic: the adversarial devil's advocate as a user-visible surface (Proposal 04, Pillar I).
//!
//! **Read-only and on-demand.** Gathering is the slice's job (correction mentions
//! and git reverts of the target files); judging is the council's. The verdict is
//! advisory — it feeds warnings and guidance, never blocks by itself, because a
//! probabilistic verdict may not veto work (recorded decision).

use anyhow::{Context, Result};
use clap::{Args, Subcommand};
use uma_core::council::{consult_skeptic, SkepticInput};
use uma_core::domain::{Fact, FactType};
use uma_core::fastbrain::Judge;
use uma_core::store::Store;

#[derive(Args, Debug, Clone)]
pub struct SkepticArgs {
    #[command(subcommand)]
    pub command: SkepticCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub enum SkepticCommand {
    /// Consult the Skeptic on a proposed intent before executing it (read-only)
    Check(CheckArgs),
}

#[derive(Args, Debug, Clone)]
pub struct CheckArgs {
    /// The synthetic Intent Statement (what the agent plans to do)
    pub intent: Vec<String>,

    /// Files the intent will touch (comma-separated)
    #[arg(long = "files", value_delimiter = ',')]
    pub files: Vec<String>,

    /// Which judge to use: jev (default) or off
    #[arg(long = "judge", default_value = "jev", value_parser = ["off", "jev"])]
    pub judge: String,

    /// Emit the critique as JSON
    #[arg(long = "json")]
    pub json: bool,
}

/// Executes the Skeptic vertical slice.
pub fn run(args: SkepticArgs) -> Result<()> {
    match args.command {
        SkepticCommand::Check(check) => check_intent(check),
    }
}

fn check_intent(args: CheckArgs) -> Result<()> {
    let intent = args.intent.join(" ");
    if intent.trim().is_empty() {
        anyhow::bail!("Nothing to consult: pass the intent text");
    }

    let (mentions, reverts) = gather_pain_proxies(&args.files)?;
    let input = SkepticInput {
        intent,
        files: args.files.clone(),
        correction_mentions: mentions,
        reverts,
    };

    let judge = match args.judge.as_str() {
        "jev" => Judge::Jev,
        _ => Judge::Offline,
    };

    let critique = consult_skeptic(&input, judge).map_err(|e| anyhow::anyhow!("Skeptic consult failed: {e}"))?;

    if args.json {
        println!(
            "{}",
            serde_json::json!({
                "failure_mode": critique.failure_mode.as_str(),
                "devil_objection": critique.devil_objection,
                "risk_level": critique.risk_level.as_str(),
                "advice": critique.advice,
                "judged_by": critique.judged_by.as_str(),
                "notes": critique.notes,
                "warrants_warning": critique.warrants_warning(),
                "pain_proxies": { "correction_mentions": mentions, "reverts": reverts },
            })
        );
        return Ok(());
    }

    println!(
        "Skeptic verdict ({}): {} · devil_objection {:.2} · {}",
        critique.judged_by.as_str(),
        critique.risk_level.as_str(),
        critique.devil_objection,
        critique.failure_mode.as_str()
    );
    println!("  {}", critique.advice);
    if critique.warrants_warning() {
        println!("  ⚠ Inject skepticism into the plan before writing code.");
    }
    if let Some(ref note) = critique.notes {
        println!("  note: {note}");
    }
    Ok(())
}

/// Counts correction mentions and git reverts across the target files.
fn gather_pain_proxies(files: &[String]) -> Result<(usize, usize)> {
    let mut mentions = 0usize;
    let mut reverts = 0usize;

    for file in files {
        let path = std::path::PathBuf::from(file);
        if path.exists() {
            mentions += correction_mentions(&path).unwrap_or(0);
            reverts += git_reverts(&path, 200).unwrap_or(0);
        }
    }

    Ok((mentions, reverts))
}

/// Counts active correction facts mentioning the file's path or stem (both scopes).
fn correction_mentions(path: &std::path::Path) -> Result<usize> {
    let needle = path.to_string_lossy().replace('\\', "/");
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default().to_string();

    let mut count = 0usize;
    for facts in project_and_global_corrections()? {
        for fact in facts {
            let haystack = format!("{} {}", fact.title, fact.body).replace('\\', "/");
            if (!stem.is_empty() && haystack.contains(&stem)) || haystack.contains(&needle) {
                count += 1;
            }
        }
    }
    Ok(count)
}

fn project_and_global_corrections() -> Result<Vec<Vec<Fact>>> {
    let mut out = Vec::new();
    if let Some(project) = Store::current_project_name() {
        if let Ok(store) = Store::project(project.clone()) {
            if let Ok(facts) = store.list(&uma_core::domain::Scope::Project(project), Some(&FactType::Correction)) {
                out.push(facts);
            }
        }
    }
    if let Ok(global) = Store::global() {
        if let Ok(facts) = global.list(&uma_core::domain::Scope::Global, Some(&FactType::Correction)) {
            out.push(facts);
        }
    }
    Ok(out)
}

/// Counts reverts of the file in git history (same heuristic as `uma risk pain`).
fn git_reverts(path: &std::path::Path, max_commits: usize) -> Result<usize> {
    let output = std::process::Command::new("git")
        .args(["log", "--oneline", &format!("-n {max_commits}"), "--", &path.to_string_lossy()])
        .output()
        .context("git log failed")?;
    let log = String::from_utf8_lossy(&output.stdout).to_lowercase();

    let mut count = 0usize;
    for line in log.lines() {
        let message = line.split_once(' ').map(|(_, m)| m).unwrap_or("");
        if message.contains("revert") || message.contains("rollback") {
            count += 1;
        }
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[derive(Parser, Debug)]
    struct TestCli {
        #[command(subcommand)]
        command: SkepticCommand,
    }

    #[test]
    fn test_skeptic_check_args_parsing() {
        let cli = TestCli::try_parse_from([
            "test",
            "check",
            "rewrite",
            "the",
            "locking",
            "--files",
            "src/indexer/mod.rs,src/store/ops.rs",
            "--judge",
            "off",
            "--json",
        ])
        .unwrap();
        // The enum has a single variant, so this destructure is irrefutable.
        let SkepticCommand::Check(args) = cli.command;
        assert_eq!(args.intent.join(" "), "rewrite the locking");
        assert_eq!(args.files.len(), 2);
        assert_eq!(args.judge, "off");
        assert!(args.json);
    }

    #[test]
    fn test_skeptic_check_defaults_to_jev() {
        let cli = TestCli::try_parse_from(["test", "check", "intent text"]).unwrap();
        let SkepticCommand::Check(args) = cli.command;
        assert_eq!(args.judge, "jev");
    }

    #[test]
    fn test_risk_level_parses() {
        assert_eq!(uma_core::council::RiskLevel::as_str(uma_core::council::RiskLevel::Dangerous), "dangerous");
    }
}

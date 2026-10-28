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

/// Shortest file stem that may count as a mention on its own. A one- or
/// two-letter stem (`b.js`, `qq.js`) matched as a raw substring hit almost
/// every fact: `vendor/rr/b.js` reported 71 covering facts in a project with
/// none, so the humility gate never asked (live finding 2026-10-28).
const MIN_STEM_LEN: usize = 3;

/// Search tokens for the target files: the full normalized path, plus the
/// file stem when it is long enough to be meaningful.
fn coverage_tokens(files: &[String]) -> Vec<String> {
    files
        .iter()
        .flat_map(|f| {
            let path = f.replace('\\', "/").to_lowercase();
            let stem = std::path::Path::new(&path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();
            let mut out = vec![path];
            if stem.chars().count() >= MIN_STEM_LEN {
                out.push(stem);
            }
            out
        })
        .filter(|t| !t.is_empty())
        .collect()
}

/// True when `token` occurs in `haystack` as a whole word: the characters
/// around the match are not alphanumeric or `_`, so `util` matches
/// "src/util.js" and "util functions" but not "utility".
fn mentions(haystack: &str, token: &str) -> bool {
    let is_word = |c: char| c.is_alphanumeric() || c == '_';
    let mut from = 0;
    while let Some(pos) = haystack[from..].find(token) {
        let start = from + pos;
        let end = start + token.len();
        let before_ok = haystack[..start].chars().next_back().map_or(true, |c| !is_word(c));
        let after_ok = haystack[end..].chars().next().map_or(true, |c| !is_word(c));
        if before_ok && after_ok {
            return true;
        }
        from = start + token.len().max(1);
        if from >= haystack.len() {
            break;
        }
    }
    false
}

/// Counts memory facts (any type, current project + global) that mention a
/// target file by its full path or by a meaningful stem, as a whole word.
fn fact_coverage(files: &[String]) -> Result<usize> {
    let tokens = coverage_tokens(files);
    if tokens.is_empty() {
        return Ok(0);
    }

    let mut count = 0usize;
    for facts in all_facts()? {
        for fact in facts {
            let haystack = format!("{} {}", fact.title, fact.body)
                .replace('\\', "/")
                .to_lowercase();
            if tokens.iter().any(|token| mentions(&haystack, token)) {
                count += 1;
            }
        }
    }
    Ok(count)
}

#[cfg(test)]
mod coverage_tests {
    use super::{coverage_tokens, mentions};

    #[test]
    fn short_stems_are_not_search_tokens() {
        let tokens = coverage_tokens(&["vendor/rr/b.js".to_string()]);
        assert_eq!(tokens, vec!["vendor/rr/b.js".to_string()]);
    }

    #[test]
    fn stems_and_paths_match_as_whole_words_only() {
        assert!(mentions("never import from src/util.js here", "util"));
        assert!(mentions("util functions validate inputs", "util"));
        assert!(!mentions("a utility belt", "util"));
        assert!(!mentions("bubble tea", "b"));
        assert!(mentions("see src/app.js.", "src/app.js"));
        assert!(!mentions("see src/app.json", "src/app.js"));
    }

    #[test]
    fn windows_paths_and_case_are_normalized() {
        let tokens = coverage_tokens(&["Src\\Util.JS".to_string()]);
        assert!(tokens.contains(&"src/util.js".to_string()));
        assert!(tokens.contains(&"util".to_string()));
    }
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

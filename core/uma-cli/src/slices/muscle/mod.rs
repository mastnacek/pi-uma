//! Muscle: operator-curated action chunks as a user-visible surface (Proposal 05, Pillar I).
//!
//! **Consent model:** `run` is a DRY-RUN by default — it prints the sequence
//! and executes nothing. Only the explicit `--confirm` flag (the operator's
//! launch-time consent, mirroring MCP's `--allow-writes`) executes the steps.
//! `new` curates a routine as a `skill` fact through the gated write path
//! (secrets scan + approval modal upstream in the plugin; CLI-side secrets gate here).

use std::io::{self, Read};

use anyhow::Result;
use clap::{Args, Subcommand};
use uma_core::muscle::{curate_routine, find_routine, run_routine, MuscleRoutine};
use uma_core::secrets;
use uma_core::store::Store;

use crate::shared::{scope::resolve_scope, store_helper::get_store};

#[derive(Args, Debug, Clone)]
pub struct MuscleArgs {
    #[command(subcommand)]
    pub command: MuscleCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub enum MuscleCommand {
    /// Run an operator-curated routine (DRY-RUN unless --confirm)
    Run(RunArgs),
    /// Curate a new routine as a skill fact (operator-curated only)
    New(NewArgs),
    /// List operator-curated routines (skill facts tagged muscle)
    List(ListArgs),
}

#[derive(Args, Debug, Clone)]
pub struct ListArgs {
    /// Emit as JSON
    #[arg(long = "json")]
    pub json: bool,
}

#[derive(Args, Debug, Clone)]
pub struct RunArgs {
    /// Routine name (a skill fact titled muscle:<name> or tagged muscle)
    pub name: String,

    /// Execute the steps (without this flag the run only prints what would execute)
    #[arg(long = "confirm")]
    pub confirm: bool,

    /// Emit the report as JSON
    #[arg(long = "json")]
    pub json: bool,
}

#[derive(Args, Debug, Clone)]
pub struct NewArgs {
    /// Routine name
    pub name: String,

    /// Routine template: JSON step list or a minimal YAML list (- command args)
    #[arg(long = "template")]
    pub template: Option<String>,

    /// Scope (project name or "global"; defaults to the current project)
    #[arg(short = 's', long = "scope")]
    pub scope: Option<String>,

    /// Optional one-line description
    #[arg(short = 'd', long = "desc")]
    pub description: Option<String>,
}

/// Executes the Muscle vertical slice.
pub fn run(args: MuscleArgs) -> Result<()> {
    match args.command {
        MuscleCommand::Run(run) => run_routine_cmd(run),
        MuscleCommand::New(new) => new_routine_cmd(new),
        MuscleCommand::List(list) => list_routines_cmd(list),
    }
}

fn list_routines_cmd(args: ListArgs) -> Result<()> {
    let routines = list_routines()?;

    if args.json {
        println!("{}", serde_json::to_string_pretty(&routines)?);
        return Ok(());
    }
    if routines.is_empty() {
        println!(
            "No operator-curated routines. Curate one: uma muscle new <name> --template '<steps json>'"
        );
        return Ok(());
    }
    println!("Operator-curated muscle routines ({}):\n", routines.len());
    for r in &routines {
        println!("  {} — {} step(s)", r.name, r.steps.len());
        for step in &r.steps {
            println!("    $ {} {}", step.command, step.args.join(" "));
        }
    }
    println!("\nRun with `uma muscle run <name>` (dry-run) or `--confirm` (execute).");
    Ok(())
}

/// Lists every curated routine across project and global skill stores.
fn list_routines() -> Result<Vec<MuscleRoutine>> {
    let mut out = Vec::new();
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    if let Some(project) = Store::current_project_name() {
        if let Ok(store) = Store::project(project) {
            roots.push(store.root.clone());
        }
    }
    if let Ok(global) = Store::global() {
        roots.push(global.root.clone());
    }

    let mut seen_names: Vec<String> = Vec::new();
    for root in &roots {
        let skill_dir = root.join("skill");
        if !skill_dir.exists() {
            continue;
        }
        for entry in walkdir::WalkDir::new(&skill_dir).into_iter().flatten() {
            if !entry.file_type().is_file()
                || entry.path().extension().is_none_or(|e| e != "md")
            {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(entry.path()) else {
                continue;
            };
            let Ok(fact) = uma_core::serialization::markdown_to_fact(&content) else {
                continue;
            };
            if !fact.tags.iter().any(|t| t.eq_ignore_ascii_case("muscle")) {
                continue;
            }
            let Some(ref template) = fact.template else {
                continue;
            };
            let name = fact.title.strip_prefix("muscle:").unwrap_or(&fact.title).to_string();
            if seen_names.contains(&name) {
                continue;
            }
            if let Ok(routine) = uma_core::muscle::parse_routine(&name, template) {
                seen_names.push(name);
                out.push(routine);
            }
        }
    }
    Ok(out)
}

fn run_routine_cmd(args: RunArgs) -> Result<()> {
    let routine = find_routine(None, &args.name)?;

    if !args.confirm {
        eprintln!("DRY-RUN (pass --confirm to execute):");
    }
    let report = run_routine(&routine, &std::env::current_dir()?, args.confirm)?;

    if args.json {
        println!("{}", serde_json::to_string_pretty(&report)?);
        return Ok(());
    }

    println!("Muscle routine '{}': {}", report.routine, report.summary);
    for step in &report.steps {
        println!(
            "  {} {}: exit {}{}",
            if step.success { "✓" } else { "✗" },
            step.command,
            step.exit_code,
            if step.output_tail.is_empty() {
                String::new()
            } else {
                format!("\n    {}", step.output_tail.replace('\n', "\n    "))
            }
        );
    }
    if !report.success {
        std::process::exit(1);
    }
    Ok(())
}

fn new_routine_cmd(args: NewArgs) -> Result<()> {
    let template = match args.template {
        Some(t) => t,
        None => {
            let mut buffer = String::new();
            io::stdin().read_to_string(&mut buffer)?;
            buffer.trim().to_string()
        }
    };
    if template.trim().is_empty() {
        anyhow::bail!("Empty routine template (pass --template or pipe steps on stdin)");
    }

    let scope = resolve_scope(args.scope)?;
    let fact = curate_routine(&args.name, &template, scope, args.description)?;

    // Same secrets gate as the write slice: a routine carrying a credential
    // must never reach the store.
    let literals: Vec<String> = secrets::env_secret_literals(&std::env::vars().collect::<Vec<_>>());
    let findings = secrets::scan(&format!("{}\n{}", fact.title, fact.template.as_deref().unwrap_or("")), &literals);
    if secrets::is_blocked(&findings) {
        anyhow::bail!("Refusing to curate: the routine contains what looks like a credential.");
    }

    let store = get_store(&fact.scope)?;
    store.write(&fact)?;
    println!(
        "Curated muscle routine: {} ({} step(s)) — run it with `uma muscle run {} --confirm`",
        fact.id,
        uma_core::muscle::parse_routine(&args.name, &template)?.steps.len(),
        args.name
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[derive(Parser, Debug)]
    struct TestCli {
        #[command(subcommand)]
        command: MuscleCommand,
    }

    #[test]
    fn test_muscle_run_args_parsing() {
        let cli = TestCli::try_parse_from(["test", "run", "verify_slice", "--confirm", "--json"]).unwrap();
        let MuscleCommand::Run(args) = cli.command else {
            panic!("Expected Run");
        };
        assert_eq!(args.name, "verify_slice");
        assert!(args.confirm);
        assert!(args.json);

        let cli = TestCli::try_parse_from(["test", "run", "verify_slice"]).unwrap();
        let MuscleCommand::Run(args) = cli.command else {
            panic!("Expected Run");
        };
        assert!(!args.confirm, "run defaults to dry-run");
    }

    #[test]
    fn test_muscle_list_args_parsing() {
        let cli = TestCli::try_parse_from(["test", "list", "--json"]).unwrap();
        let MuscleCommand::List(args) = cli.command else {
            panic!("Expected List");
        };
        assert!(args.json);
    }

    #[test]
    fn test_muscle_new_args_parsing() {
        let cli = TestCli::try_parse_from([
            "test",
            "new",
            "verify_slice",
            "--template",
            r#"[{"command":"cargo","args":["test"]}]"#,
            "--scope",
            "global",
        ])
        .unwrap();
        let MuscleCommand::New(args) = cli.command else {
            panic!("Expected New");
        };
        assert_eq!(args.name, "verify_slice");
        assert!(args.template.as_deref().unwrap().contains("cargo"));
        assert_eq!(args.scope.as_deref(), Some("global"));
    }
}
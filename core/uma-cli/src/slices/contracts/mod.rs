//! Contracts: executable AST invariants compilation and checking (Proposal 03a).

use std::path::PathBuf;

use anyhow::Result;
use clap::{Args, Subcommand};
use uma_core::contracts::{check_contracts, export_contracts, CheckOptions};
use uma_core::store::Store;

#[derive(Args, Debug, Clone)]
pub struct ContractsArgs {
    #[command(subcommand)]
    pub command: ContractsCommand,
}

#[derive(Subcommand, Debug, Clone)]
pub enum ContractsCommand {
    /// Export active AST contracts to .uma/contracts/sgconfig.yml and CI test harness
    Export(ExportArgs),
    /// Check the codebase against active AST contracts (deterministic CI and interceptor gate)
    Check(CheckArgs),
}

#[derive(Args, Debug, Clone)]
pub struct ExportArgs {
    /// Output directory for ast-grep rules (defaults to .uma/contracts)
    #[arg(long = "out")]
    pub out: Option<PathBuf>,

    /// Emit report as JSON
    #[arg(long = "json")]
    pub json: bool,
}

#[derive(Args, Debug, Clone)]
pub struct CheckArgs {
    /// Specific file or directory to scan
    #[arg(long = "path")]
    pub path: Option<PathBuf>,

    /// Specific rule or fact ID filter
    #[arg(long = "rule")]
    pub rule: Option<String>,

    /// Exit with error code 1 if any violations are found (for CI / pre-commit)
    #[arg(long = "strict")]
    pub strict: bool,

    /// Emit findings as JSON
    #[arg(long = "json")]
    pub json: bool,
}

fn resolve_store() -> Result<Store> {
    if let Some(project) = Store::current_project_name() {
        if let Ok(store) = Store::project(project) {
            return Ok(store);
        }
    }
    Store::global()
}

/// Executes the Contracts vertical slice.
pub fn run(args: ContractsArgs) -> Result<()> {
    match args.command {
        ContractsCommand::Export(export) => run_export(export),
        ContractsCommand::Check(check) => run_check(check),
    }
}

fn run_export(args: ExportArgs) -> Result<()> {
    let store = resolve_store()?;
    let git_root = Store::find_git_root().unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());
    let target = args.out.unwrap_or_else(|| git_root.join(".uma").join("contracts"));

    let report = export_contracts(&store, &target)?;

    if args.json {
        println!("{}", serde_json::to_string_pretty(&report)?);
        return Ok(());
    }

    println!(
        "Exported {} active contract(s) to {:?}",
        report.contracts_exported, report.target_dir
    );
    if let Some(harness) = report.test_harness {
        println!("Generated test harness at {:?}", harness);
    }
    Ok(())
}

fn run_check(args: CheckArgs) -> Result<()> {
    let store = resolve_store()?;
    let opts = CheckOptions {
        path_filter: args.path,
        rule_filter: args.rule,
    };

    let report = check_contracts(&store, &opts)?;

    if args.json {
        println!("{}", serde_json::to_string_pretty(&report)?);
        if args.strict && !report.clean {
            std::process::exit(1);
        }
        return Ok(());
    }

    if let Some(ref note) = report.notes {
        println!("ℹ {}", note);
    }

    if report.clean {
        println!(
            "✓ All active contracts passed ({} rule(s) checked via {})",
            report.rules_checked, report.engine
        );
        return Ok(());
    }

    println!(
        "✗ {} contract violation(s) detected via {}:\n",
        report.violations.len(),
        report.engine
    );

    for (idx, v) in report.violations.iter().enumerate() {
        println!(
            "{}. [{}] {} at {}:{}",
            idx + 1,
            v.severity,
            v.rule_id,
            v.file,
            v.line
        );
        println!("   Message: {}", v.message);
        if !v.snippet.is_empty() {
            println!("   Code: {}", v.snippet);
        }
        println!();
    }

    if args.strict {
        std::process::exit(1);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[derive(Parser, Debug)]
    struct TestCli {
        #[command(subcommand)]
        command: ContractsCommand,
    }

    #[test]
    fn test_contracts_export_args_parsing() {
        let cli = TestCli::try_parse_from(["test", "export", "--json"]).unwrap();
        match cli.command {
            ContractsCommand::Export(args) => assert!(args.json),
            _ => panic!("Expected Export"),
        }
    }

    #[test]
    fn test_contracts_check_args_parsing() {
        let cli = TestCli::try_parse_from(["test", "check", "--path", "src/main.rs", "--strict", "--json"]).unwrap();
        match cli.command {
            ContractsCommand::Check(args) => {
                assert_eq!(args.path, Some(PathBuf::from("src/main.rs")));
                assert!(args.strict);
                assert!(args.json);
            }
            _ => panic!("Expected Check"),
        }
    }
}

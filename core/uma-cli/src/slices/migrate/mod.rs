use anyhow::Result;
use clap::Args;
use uma_core::{
    domain::{ActorEvent, Scope},
    serialization::{fact_to_markdown, markdown_to_fact},
    store::Store,
};
use walkdir::WalkDir;

#[derive(Args, Debug, Clone)]
pub struct MigrateArgs {
    /// Only report what would change without writing files
    #[arg(long = "dry-run")]
    pub dry_run: bool,

    /// Also rebuild the centralized FTS5 index after reformatting
    #[arg(long = "reindex")]
    pub reindex: bool,
}

/// Executes the Migrate vertical slice: rewrites existing markdown files into OKF v0.2 frontmatter.
pub fn run(args: MigrateArgs) -> Result<()> {
    let mut roots: Vec<(Scope, std::path::PathBuf)> = Vec::new();

    if let Ok(global) = Store::global() {
        roots.push((Scope::Global, global.root.clone()));
    }

    if let Some(project_name) = Store::current_project_name() {
        if let Ok(project) = Store::project(project_name.clone()) {
            roots.push((Scope::Project(project_name), project.root.clone()));
        }
    }

    let mut scanned = 0usize;
    let mut migrated = 0usize;
    let mut failed = 0usize;

    for (scope, root) in &roots {
        if !root.exists() {
            continue;
        }

        for entry in WalkDir::new(root).into_iter().flatten() {
            let path = entry.path();
            if !entry.file_type().is_file() || path.extension().is_none_or(|e| e != "md") {
                continue;
            }

            scanned += 1;
            let content = match std::fs::read_to_string(path) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("  ! read failed {:?}: {}", path, e);
                    failed += 1;
                    continue;
                }
            };

            let mut fact = match markdown_to_fact(&content) {
                Ok(f) => f,
                Err(e) => {
                    eprintln!("  ! parse failed {:?}: {}", path, e);
                    failed += 1;
                    continue;
                }
            };

            // Migration: reattach to the canonical store root (it no longer
            // nests a project directory) and backfill OKF v0.2 provenance keys.
            fact.scope = scope.clone();
            backfill_provenance(&mut fact);

            let rendered = match fact_to_markdown(&fact) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("  ! serialize failed {:?}: {}", path, e);
                    failed += 1;
                    continue;
                }
            };

            if rendered == content {
                continue;
            }

            if args.dry_run {
                println!("  ~ would reformat {:?}", path);
                migrated += 1;
                continue;
            }

            match std::fs::write(path, rendered) {
                Ok(()) => {
                    println!("  + reformatted {:?}", path);
                    migrated += 1;
                }
                Err(e) => {
                    eprintln!("  ! write failed {:?}: {}", path, e);
                    failed += 1;
                }
            }
        }
    }

    println!(
        "\nScanned {} file(s): {} reformatted, {} failed.{}{}",
        scanned,
        migrated,
        failed,
        if args.dry_run { " (dry run)" } else { "" },
        if args.reindex { " Reindexing..." } else { "" }
    );

    if args.reindex && !args.dry_run {
        let count = Store::reindex_all()?;
        println!("Reindexed {} fact(s) into centralized index.", count);
    }

    // A migration that skipped files must not report success: a script or CI
    // checking only the exit code would otherwise treat data loss as fine.
    if failed > 0 {
        anyhow::bail!("migration completed with {failed} failure(s)");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[derive(Parser, Debug)]
    struct TestCli {
        #[command(flatten)]
        args: MigrateArgs,
    }

    #[test]
    fn test_migrate_args_parsing() -> Result<(), clap::Error> {
        let cli = TestCli::try_parse_from(["test", "--dry-run", "--reindex"])?;
        assert!(cli.args.dry_run);
        assert!(cli.args.reindex);

        let cli2 = TestCli::try_parse_from(["test"])?;
        assert!(!cli2.args.dry_run);
        assert!(!cli2.args.reindex);
        Ok(())
    }
}

/// Provenance recorded for a legacy fact whose author is unknown.
const LEGACY_GENERATOR: &str = "legacy:unknown";

/// Backfills OKF v0.2 provenance keys honestly.
///
/// `generated` gets an explicit "unknown author" marker instead of claiming a
/// specific agent. `verified` is NEVER backfilled: verification is a human
/// act, and stamping `human:operator` on a fact nobody reviewed falsified its
/// provenance (live finding 2026-10-28).
fn backfill_provenance(fact: &mut uma_core::domain::Fact) {
    if fact.generated.is_none() {
        fact.generated = Some(ActorEvent {
            by: LEGACY_GENERATOR.to_string(),
            at: fact.validity.since,
        });
    }
}

#[cfg(test)]
mod provenance_tests {
    use super::{backfill_provenance, LEGACY_GENERATOR};
    use uma_core::serialization::markdown_to_fact;

    const LEGACY: &str = "---\nid: 01M4N20M6X3P8H9KZ01V5E729Y\nscope: global\ntype: decision\ntitle: Legacy fact\nstatus: stable\nsince: \"2026-10-11T10:45:00+00:00\"\n---\nBody.\n";

    #[test]
    fn migration_never_invents_a_human_verification() {
        let mut fact = markdown_to_fact(LEGACY).expect("legacy fact parses");
        assert!(fact.verified.is_empty(), "setup: no verification");
        backfill_provenance(&mut fact);
        assert!(fact.verified.is_empty(), "verified must stay empty: {:?}", fact.verified);
        assert_eq!(fact.generated.as_ref().map(|g| g.by.as_str()), Some(LEGACY_GENERATOR));
    }

    #[test]
    fn existing_provenance_is_kept() {
        let mut fact = markdown_to_fact(LEGACY).expect("legacy fact parses");
        fact.generated = Some(uma_core::domain::ActorEvent { by: "pi-agent/1.1".into(), at: fact.validity.since });
        backfill_provenance(&mut fact);
        assert_eq!(fact.generated.as_ref().unwrap().by, "pi-agent/1.1");
    }
}

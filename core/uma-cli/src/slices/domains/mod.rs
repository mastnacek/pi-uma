use anyhow::{Context, Result};
use clap::{Args, Subcommand};
use std::path::PathBuf;
use std::str::FromStr;
use uma_core::{
    domain::{Fact, FactId},
    serialization::{fact_to_markdown, markdown_to_fact},
    store::Store,
};
use walkdir::WalkDir;

#[derive(Args, Debug)]
#[command(about = "Manage domain tags on memory facts")]
pub struct DomainsArgs {
    #[command(subcommand)]
    pub command: DomainsCommands,
}

#[derive(Subcommand, Debug)]
pub enum DomainsCommands {
    /// Set a domain tag on one or more memory facts
    Set(SetDomainsArgs),
}

#[derive(Args, Debug)]
pub struct SetDomainsArgs {
    /// Domain tag to assign (e.g. 'domino')
    #[arg(long = "domain", required = true)]
    pub domain: String,

    /// One or more fact IDs (ULIDs) to update
    #[arg(required = true)]
    pub ids: Vec<String>,
}

pub fn run(args: DomainsArgs) -> Result<()> {
    match args.command {
        DomainsCommands::Set(set_args) => run_set(set_args),
    }
}

fn run_set(args: SetDomainsArgs) -> Result<()> {
    let domain = args.domain.trim().to_lowercase();
    if domain.is_empty() {
        anyhow::bail!("Domain cannot be empty");
    }

    let mut updated_count = 0;

    for id_str in &args.ids {
        let fact_id = FactId::from_str(id_str)
            .with_context(|| format!("Invalid FactId: {id_str}"))?;

        let (mut fact, path) = find_fact_file(&fact_id)?;

        if !fact.domains.iter().any(|d| d.eq_ignore_ascii_case(&domain)) {
            fact.domains.push(domain.clone());
        }

        let new_content = fact_to_markdown(&fact)
            .with_context(|| format!("Failed to serialize fact {fact_id}"))?;

        let tmp_path = path.with_extension(format!("tmp.{}", FactId::new()));
        std::fs::write(&tmp_path, &new_content)
            .with_context(|| format!("Failed to write temporary file {:?}", tmp_path))?;
        if let Err(e) = std::fs::rename(&tmp_path, &path) {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(e).with_context(|| format!("Failed to rename {:?} to {:?}", tmp_path, path));
        }

        println!("Updated domains for {fact_id} ({:?}) -> [{}]", path, fact.domains.join(", "));
        updated_count += 1;
    }

    println!("Reindexing search cache...");
    let reindexed = Store::reindex_all()?;
    println!("Done. Updated {updated_count} fact(s), reindexed {reindexed} entries.");

    Ok(())
}

fn find_fact_file(fact_id: &FactId) -> Result<(Fact, PathBuf)> {
    // 1. Try central indexer's recorded file_path
    if let Ok(indexer) = Store::central_indexer() {
        let query = "SELECT file_path FROM facts_fts WHERE id = ?";
        if let Ok(path_str) = indexer.connection().query_row(query, [fact_id.to_string()], |r| r.get::<_, String>(0)) {
            let path = PathBuf::from(path_str);
            if path.exists() {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(fact) = markdown_to_fact(&content) {
                        if fact.id == *fact_id {
                            return Ok((fact, path));
                        }
                    }
                }
            }
        }
    }

    // 2. Try global store root
    if let Ok(global_store) = Store::global() {
        for entry in WalkDir::new(&global_store.root).into_iter().flatten() {
            if entry.file_type().is_file() && entry.path().extension().is_some_and(|e| e == "md") {
                if let Ok(content) = std::fs::read_to_string(entry.path()) {
                    if let Ok(fact) = markdown_to_fact(&content) {
                        if fact.id == *fact_id {
                            return Ok((fact, entry.path().to_path_buf()));
                        }
                    }
                }
            }
        }
    }

    // 3. Try current project store root
    if let Some(project_name) = Store::current_project_name() {
        if let Ok(project_store) = Store::project(project_name) {
            for entry in WalkDir::new(&project_store.root).into_iter().flatten() {
                if entry.file_type().is_file() && entry.path().extension().is_some_and(|e| e == "md") {
                    if let Ok(content) = std::fs::read_to_string(entry.path()) {
                        if let Ok(fact) = markdown_to_fact(&content) {
                            if fact.id == *fact_id {
                                return Ok((fact, entry.path().to_path_buf()));
                            }
                        }
                    }
                }
            }
        }
    }

    anyhow::bail!("Fact file for {fact_id} not found on disk");
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[derive(Parser, Debug)]
    struct CliTest {
        #[command(subcommand)]
        cmd: DomainsCommands,
    }

    #[test]
    fn test_domains_set_args_parsing() {
        let args = CliTest::parse_from(["uma", "set", "--domain", "domino", "01M5WQXK7VFFRTTS1CGKD77WN6"]);
        match args.cmd {
            DomainsCommands::Set(set_args) => {
                assert_eq!(set_args.domain, "domino");
                assert_eq!(set_args.ids, vec!["01M5WQXK7VFFRTTS1CGKD77WN6"]);
            }
        }
    }
}

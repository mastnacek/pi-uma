//! Live, read-only SPAI backlog search for `uma search --source spai` (SPAI-036).
//!
//! Kept out of the fact index on purpose: SPAI is the volatile work ledger and
//! UMA the durable knowledge base (decision 01M4WY0WX6MAY62J6VHC51HV66), so a
//! separate query path is what guarantees task state can never enter recall,
//! consolidation or the semantic store.

use anyhow::{Context, Result};
use std::path::PathBuf;
use uma_core::{domain::Scope, spai::search_backlog, store::Store};

use super::SearchArgs;
use crate::shared::scope::resolve_scope;

/// Resolves the `docs/spai` directories to scan for the requested scope.
///
/// SPAI backlogs exist only per project, so `--scope global` is rejected with
/// an explanation instead of silently returning nothing.
pub fn spai_backlogs(scope: Option<&Scope>) -> Result<Vec<(String, PathBuf)>> {
    match scope {
        Some(Scope::Global) => anyhow::bail!(
            "SPAI backlogs live per project (docs/spai). Omit --scope for the current repository or pass --scope <project>"
        ),
        Some(Scope::Project(name)) => {
            let project_root = if Store::current_project_name().as_deref() == Some(name.as_str()) {
                Store::find_git_root()?
            } else {
                Store::foreign_store_root(name)?
                    .and_then(|uma_root| uma_root.parent().map(PathBuf::from))
                    .with_context(|| {
                        format!(
                            "Project '{name}' is not the current repository and the central index has no record of its files"
                        )
                    })?
            };
            Ok(vec![(name.clone(), project_root.join("docs").join("spai"))])
        }
        None => {
            let git_root = Store::find_git_root().context(
                "SPAI backlogs are per project: run inside a git repository or pass --scope <project>",
            )?;
            let name = Store::current_project_name().unwrap_or_else(|| {
                git_root
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("project")
                    .to_string()
            });
            Ok(vec![(name, git_root.join("docs").join("spai"))])
        }
    }
}

/// Live search over the resolved backlog(s), status-weighted and UTF-8 safe.
pub fn run_spai_search(args: &SearchArgs) -> Result<()> {
    if args.query.trim().is_empty() {
        if args.json {
            println!(
                "{}",
                serde_json::json!({"source": "spai", "hits": [], "note": "empty query"})
            );
        } else {
            println!("Please provide a search query: uma search --source spai <query>");
        }
        return Ok(());
    }

    let scope = match args.scope.as_deref() {
        Some(s) => Some(resolve_scope(Some(s.to_string()))?),
        None => None,
    };
    let backlogs = spai_backlogs(scope.as_ref())?;

    let mut hits: Vec<(String, uma_core::spai::SpaiSearchHit)> = Vec::new();
    for (project, dir) in &backlogs {
        for hit in search_backlog(dir, &args.query, args.limit) {
            hits.push((project.clone(), hit));
        }
    }
    hits.sort_by(|a, b| {
        b.1.score
            .partial_cmp(&a.1.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.1.id.cmp(&b.1.id))
    });
    hits.truncate(args.limit);

    if args.json {
        let payload: Vec<_> = hits
            .iter()
            .map(|(project, hit)| {
                serde_json::json!({
                    "id": hit.id,
                    "title": hit.title,
                    "status": hit.status,
                    "score": hit.score,
                    "snippet": hit.snippet,
                    "project": project,
                    "file_path": hit.file_path.to_string_lossy(),
                })
            })
            .collect();
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "source": "spai",
                "degraded": false,
                "note": serde_json::Value::Null,
                "hits": payload,
            }))?
        );
        return Ok(());
    }

    if hits.is_empty() {
        println!(
            "No SPAI items matching '{}' found (source: spai, live).",
            args.query
        );
        let missing: Vec<_> = backlogs
            .iter()
            .filter(|(_, dir)| !dir.is_dir())
            .map(|(_, dir)| dir.display().to_string())
            .collect();
        if !missing.is_empty() {
            println!("! No docs/spai directory at: {}", missing.join(", "));
        }
        return Ok(());
    }

    println!(
        "Found {} SPAI item(s) matching '{}' (source: spai, live):\n",
        hits.len(),
        args.query
    );
    for (idx, (project, hit)) in hits.iter().enumerate() {
        println!(
            "{}. {} [{}] {} (score: {:.3})",
            idx + 1,
            hit.id,
            hit.status,
            hit.title,
            hit.score
        );
        println!("   Project: {}", project);
        if !hit.snippet.is_empty() {
            println!("   Match: {}", hit.snippet);
        }
        println!("   File: {}", hit.file_path.display());
        println!();
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn global_scope_is_rejected_with_an_explanation() {
        let err = spai_backlogs(Some(&Scope::Global)).expect_err("global has no backlog");
        assert!(err.to_string().contains("per project"));
    }

    #[test]
    fn default_scope_resolves_the_current_repository_backlog() {
        // Tests run inside the pi-uma repository, so the default resolves its
        // own docs/spai — the same path the CLI uses.
        let backlogs = spai_backlogs(None).expect("inside a git repository");
        assert_eq!(backlogs.len(), 1);
        assert!(
            backlogs[0].1.ends_with("docs/spai"),
            "got {:?}",
            backlogs[0].1
        );
    }

    #[test]
    fn project_scope_resolves_that_projects_backlog() {
        let current = Store::current_project_name().expect("in a repo");
        let backlogs = spai_backlogs(Some(&Scope::Project(current))).expect("current project");
        assert_eq!(backlogs.len(), 1);
        assert!(backlogs[0].1.ends_with("docs/spai"));
    }

    #[test]
    fn unknown_foreign_project_fails_closed() {
        let result = spai_backlogs(Some(&Scope::Project(
            "definitely-not-indexed-xyz".to_string(),
        )));
        assert!(
            result.is_err(),
            "an unknown project must not silently match nothing"
        );
    }
}

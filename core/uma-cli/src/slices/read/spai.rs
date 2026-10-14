//! Live SPAI link resolution for `uma read --resolve-spai` (SPAI-034).
//!
//! SPAI stays the volatile work ledger, UMA the durable knowledge base
//! (decision 01M4WY0WX6MAY62J6VHC51HV66): this module only READS `docs/spai`
//! item files — the live status is always read from the item itself, never
//! from a cached index, and nothing here writes to either store.
//!
//! Scanning, canonicalization and metadata parsing live in the shared kernel
//! (`uma_core::spai`, SPAI-036) so the read and search slices agree by
//! construction on what an item ID or status is.

use std::path::PathBuf;
use uma_core::domain::{Fact, Scope};
use uma_core::spai::{find_item, read_item_meta, scan_ids};
use uma_core::store::Store;

/// One resolved SPAI cross-reference: the normalized ID plus the live
/// status/title read from the item's own frontmatter. `status == None`
/// means the reference could not be resolved to an existing item file.
#[derive(Debug, Clone, PartialEq)]
pub struct SpaiLink {
    pub id: String,
    pub status: Option<String>,
    pub title: Option<String>,
    pub path: Option<PathBuf>,
}

/// IDs to resolve for a fact: the structural `spai` frontmatter field first
/// (in declared order), then any additional `SPAI-NNN` mentions in the body.
pub fn collect_ids(fact: &Fact) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in &fact.spai {
        for id in scan_ids(raw) {
            if !out.contains(&id) {
                out.push(id);
            }
        }
    }
    for id in scan_ids(&fact.body) {
        if !out.contains(&id) {
            out.push(id);
        }
    }
    out
}

/// Candidate `docs/spai` directories, resolved WITHOUT mutating anything:
/// the current git repository first, then the fact's own project store
/// (via the read-only central-index root lookup). Never uses
/// `Store::project`, which creates directories for the current repo.
fn candidate_dirs(fact: &Fact) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(git_root) = Store::find_git_root() {
        dirs.push(git_root.join("docs").join("spai"));
    }
    if let Scope::Project(name) = &fact.scope {
        if let Ok(Some(root)) = Store::foreign_store_root(name) {
            if let Some(project_root) = root.parent() {
                let dir = project_root.join("docs").join("spai");
                if !dirs.contains(&dir) {
                    dirs.push(dir);
                }
            }
        }
    }
    dirs.retain(|d| d.is_dir());
    dirs
}

/// Resolves every SPAI reference of a fact against the live backlog files.
pub fn resolve_all(fact: &Fact) -> Vec<SpaiLink> {
    let dirs = candidate_dirs(fact);
    collect_ids(fact)
        .into_iter()
        .map(|id| {
            let number: u64 = id["SPAI-".len()..].parse().unwrap_or(0);
            let found = dirs.iter().find_map(|dir| find_item(dir, number));
            match found {
                Some(path) => {
                    let (status, title) = read_item_meta(&path)
                        .map(|(meta, _)| (meta.status, meta.title))
                        .unwrap_or((None, None));
                    SpaiLink {
                        id,
                        status,
                        title,
                        path: Some(path),
                    }
                }
                None => SpaiLink {
                    id,
                    status: None,
                    title: None,
                    path: None,
                },
            }
        })
        .collect()
}

/// Renders the human-readable live-links section appended to `uma read` output.
pub fn render_section(links: &[SpaiLink]) -> String {
    if links.is_empty() {
        return "SPAI links: none declared in the spai field or mentioned in the body.".to_string();
    }
    let mut out = String::from("SPAI links (live from docs/spai):");
    for link in links {
        match (&link.status, &link.title) {
            (Some(status), title) => {
                let title = title
                    .as_deref()
                    .map(|t| {
                        if t.chars().count() > 80 {
                            format!("{}…", t.chars().take(80).collect::<String>())
                        } else {
                            t.to_string()
                        }
                    })
                    .unwrap_or_else(|| "(untitled)".to_string());
                out.push_str(&format!("\n  {} [{}] {}", link.id, status, title));
            }
            (None, _) => {
                out.push_str(&format!(
                    "\n  {} [unresolved] no docs/spai item found",
                    link.id
                ));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use uma_core::domain::FactType;

    fn fact_with(body: &str, spai: &[&str]) -> Fact {
        let mut fact = Fact::new(
            Scope::Project("demo".to_string()),
            FactType::Decision,
            "t".to_string(),
            body.to_string(),
        );
        fact.spai = spai.iter().map(|s| s.to_string()).collect();
        fact
    }

    #[test]
    fn collect_ids_puts_structural_field_first() {
        let fact = fact_with("body mentions SPAI-036 and SPAI-035", &["SPAI-035"]);
        assert_eq!(collect_ids(&fact), vec!["SPAI-035", "SPAI-036"]);
    }

    #[test]
    fn collect_ids_ignores_facts_without_references() {
        let fact = fact_with("no references here", &[]);
        assert!(collect_ids(&fact).is_empty());
    }

    #[test]
    fn collect_ids_canonicalizes_field_and_body() {
        let fact = fact_with("see spai-7", &["SPAI-35"]);
        assert_eq!(collect_ids(&fact), vec!["SPAI-035", "SPAI-007"]);
    }

    #[test]
    fn render_section_marks_unresolved_without_panicking() {
        let links = vec![SpaiLink {
            id: "SPAI-999".to_string(),
            status: None,
            title: None,
            path: None,
        }];
        assert!(render_section(&links).contains("SPAI-999 [unresolved]"));
    }

    #[test]
    fn render_section_reports_absence_clearly() {
        assert!(render_section(&[]).contains("none declared"));
    }

    #[test]
    fn resolve_all_finds_items_in_a_live_directory() {
        // A fact in the current repo resolves against this repository's own
        // docs/spai — the same code path the CLI uses, exercised for real.
        let fact = fact_with("", &["SPAI-034"]);
        let links = resolve_all(&fact);
        assert_eq!(links.len(), 1);
        assert!(links[0].path.is_some(), "SPAI-034 item exists in this repo");
        assert!(links[0].status.is_some());
    }
}

//! Live SPAI link resolution for `uma read --resolve-spai` (SPAI-034).
//!
//! SPAI stays the volatile work ledger, UMA the durable knowledge base
//! (decision 01M4WVY8NVB2WNKKZH3497Y8K9): this module only READS `docs/spai`
//! item files — the live status is always read from the item itself, never
//! from a cached index, and nothing here writes to either store.

use std::path::{Path, PathBuf};
use uma_core::domain::{Fact, Scope};
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

/// Normalizes a SPAI numeric id to the canonical `SPAI-%03d` display form
/// (`SPAI-35` and `SPAI-035` are the same item).
fn canonical_id(number: u64) -> String {
    format!("SPAI-{number:03}")
}

/// Extracts every `SPAI-<digits>` mention from free text, case-insensitive,
/// normalized and de-duplicated in first-seen order.
pub fn scan_ids(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i + 5 <= bytes.len() {
        if bytes[i..i + 5].eq_ignore_ascii_case(b"spai-") {
            let start = i + 5;
            let mut end = start;
            while end < bytes.len() && bytes[end].is_ascii_digit() {
                end += 1;
            }
            if end > start {
                if let Ok(n) = text[start..end].parse::<u64>() {
                    let id = canonical_id(n);
                    if !out.contains(&id) {
                        out.push(id);
                    }
                }
                i = end;
                continue;
            }
        }
        i += 1;
    }
    out
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

/// Finds the item file for a numeric SPAI id inside one directory.
/// Matches on the parsed number, not the string, so padding never matters.
fn find_item(dir: &Path, number: u64) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !name.ends_with(".md") {
            continue;
        }
        for id in scan_ids(name) {
            if id == canonical_id(number) {
                return Some(entry.path());
            }
        }
    }
    None
}

/// Reads `status` and `title` from the item's YAML frontmatter with a
/// minimal line parser — the pi-spai writer emits simple `key: value`
/// lines, so a full YAML dependency is unnecessary here.
fn parse_item(path: &Path) -> (Option<String>, Option<String>) {
    let Ok(content) = std::fs::read_to_string(path) else {
        return (None, None);
    };
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (None, None);
    }
    let frontmatter = trimmed.split("\n---").next().unwrap_or(trimmed);
    let mut status = None;
    let mut title = None;
    for line in frontmatter.lines() {
        if let Some(rest) = line.strip_prefix("status:") {
            status = Some(rest.trim().trim_matches(['\'', '"']).to_string());
        } else if let Some(rest) = line.strip_prefix("title:") {
            title = Some(rest.trim().trim_matches(['\'', '"']).to_string());
        }
    }
    (status, title)
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
                    let (status, title) = parse_item(&path);
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
                out.push_str(&format!("\n  {} [unresolved] no docs/spai item found", link.id));
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
    fn scan_ids_normalizes_and_dedups() {
        let ids = scan_ids("see SPAI-035, spai-35 and SPAI-7; not SPAI- or XSPAI-9x SPAI-035");
        assert_eq!(ids, vec!["SPAI-035", "SPAI-007", "SPAI-009"]);
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
    fn parse_item_reads_status_and_title() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("2026-10-14-SPAI-035-demo.md");
        std::fs::write(
            &path,
            "---\ntype: Todo\ntitle: \"Tier 1a: demo\"\nstatus: done\n---\n\nx body\n",
        )
        .expect("write item");
        let (status, title) = parse_item(&path);
        assert_eq!(status.as_deref(), Some("done"));
        assert_eq!(title.as_deref(), Some("Tier 1a: demo"));
    }

    #[test]
    fn find_item_matches_on_number_not_padding() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("2026-10-14-SPAI-035-demo.md");
        std::fs::write(&path, "---\nstatus: todo\n---\n").expect("write item");
        assert_eq!(find_item(dir.path(), 35), Some(path));
        assert!(find_item(dir.path(), 36).is_none());
        assert!(find_item(Path::new("D:/definitely/not/here"), 35).is_none());
    }

    #[test]
    fn render_section_marks_unresolved_without_panicking() {
        let links = vec![SpaiLink {
            id: "SPAI-999".to_string(),
            status: None,
            title: None,
            path: None,
        }];
        let text = render_section(&links);
        assert!(text.contains("SPAI-999 [unresolved]"));
    }
}

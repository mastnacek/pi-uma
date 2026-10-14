//! Live SPAI link resolution for `uma read --resolve-spai` (SPAI-034, SPAI-042).
//!
//! SPAI stays the volatile work ledger, UMA the durable knowledge base
//! (decision 01M4WY0WX6MAY62J6VHC51HV66): this module only READS `docs/spai`
//! item files — the live status is always read from the item itself, never
//! from a cached index, and nothing here writes to either store.
//!
//! Scanning, canonicalization, metadata parsing and reference parsing live in the
//! shared kernel (`uma_core::spai`).

use std::path::{Path, PathBuf};
use uma_core::domain::{Fact, Scope};
use uma_core::spai::{find_item, parse_reference, read_item_meta, scan_ids, SpaiRef};
use uma_core::store::Store;

/// One resolved SPAI cross-reference.
///
/// `status == None` means the reference could not be resolved to an existing
/// item file. `via` names the project the item was actually found in, and is
/// `None` when that is simply the current repository — the suffix is only worth
/// showing when it tells the reader something.
#[derive(Debug, Clone, PartialEq)]
pub struct SpaiLink {
    pub id: String,
    /// Project named by a qualified reference, when one was written.
    pub project: Option<String>,
    pub status: Option<String>,
    pub title: Option<String>,
    pub path: Option<PathBuf>,
    pub via: Option<String>,
}

/// The current repository's project label, for choosing what `via` should say.
fn current_label() -> Option<String> {
    Store::current_project_name().or_else(|| {
        Store::find_git_root()
            .ok()
            .and_then(|root| root.file_name().map(|n| n.to_string_lossy().into_owned()))
    })
}

/// References to resolve for a fact: the structural `spai` field first (in
/// declared order, qualified forms allowed), then additional `SPAI-NNN` body
/// mentions as bare references.
pub fn collect_refs(fact: &Fact) -> Vec<SpaiRef> {
    let mut out: Vec<SpaiRef> = Vec::new();
    let push = |reference: SpaiRef, out: &mut Vec<SpaiRef>| {
        if !out
            .iter()
            .any(|existing| existing.id == reference.id && existing.project == reference.project)
        {
            out.push(reference);
        }
    };

    for raw in &fact.spai {
        if let Some(reference) = parse_reference(raw) {
            push(reference, &mut out);
        }
    }
    for id in scan_ids(&fact.body) {
        push(SpaiRef { project: None, id }, &mut out);
    }
    out
}

/// Backlogs that may hold this fact's references: the current repository first,
/// then the fact's own project store. Resolved WITHOUT mutating anything — never
/// `Store::project`, which creates directories for the current repo.
fn candidate_backlogs(fact: &Fact) -> Vec<(String, PathBuf)> {
    let mut out: Vec<(String, PathBuf)> = Vec::new();
    if let Ok(git_root) = Store::find_git_root() {
        let label = current_label().unwrap_or_else(|| ".".to_string());
        out.push((label, git_root.join("docs").join("spai")));
    }
    if let Scope::Project(name) = &fact.scope {
        if let Ok(Some(root)) = Store::foreign_store_root(name) {
            if let Some(project_root) = root.parent() {
                let dir = project_root.join("docs").join("spai");
                if !out.iter().any(|(_, existing)| existing == &dir) {
                    out.push((name.clone(), dir));
                }
            }
        }
    }
    out.retain(|(_, dir)| dir.is_dir());
    out
}

/// Backlogs to try for one reference, most specific first.
///
/// Pure (no filesystem access) so the ordering rule is tested rather than
/// assumed: a qualified reference must resolve in the project it names, and a
/// bare one tries the fact's own project before falling back to the rest.
pub fn target_dirs(
    reference: &SpaiRef,
    fact_label: Option<&str>,
    backlogs: &[(String, PathBuf)],
) -> Vec<(String, PathBuf)> {
    let mut out: Vec<(String, PathBuf)> = Vec::new();
    let push = |label: String, dir: PathBuf, out: &mut Vec<(String, PathBuf)>| {
        if !out.iter().any(|(l, d)| l == &label && d == &dir) {
            out.push((label, dir));
        }
    };

    match &reference.project {
        Some(project) => {
            if let Some((label, dir)) = backlogs
                .iter()
                .find(|(label, _)| label.eq_ignore_ascii_case(project))
            {
                push(label.clone(), dir.clone(), &mut out);
            }
            // The qualifier may be a filesystem path; keep it as a candidate even
            // when it does not exist, so the reader sees "unresolved in X".
            let as_path = Path::new(project).join("docs").join("spai");
            let label = Path::new(project)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(project.as_str())
                .to_string();
            push(label, as_path, &mut out);
        }
        None => {
            if let Some(own) = fact_label {
                if let Some((label, dir)) = backlogs.iter().find(|(label, _)| label == own) {
                    push(label.clone(), dir.clone(), &mut out);
                }
            }
            for (label, dir) in backlogs {
                push(label.clone(), dir.clone(), &mut out);
            }
        }
    }
    out
}

/// Resolves every SPAI reference of a fact against the live backlog files.
pub fn resolve_all(fact: &Fact) -> Vec<SpaiLink> {
    let refs = collect_refs(fact);
    if refs.is_empty() {
        return Vec::new();
    }

    let backlogs = candidate_backlogs(fact);
    let fact_label = match &fact.scope {
        Scope::Project(name) => Some(name.as_str()),
        Scope::Global => None,
    };
    let current = current_label();

    refs.into_iter()
        .map(|reference| {
            let number: u64 = reference.id["SPAI-".len()..].parse().unwrap_or(0);
            for (label, dir) in target_dirs(&reference, fact_label, &backlogs) {
                if let Some(path) = find_item(&dir, number) {
                    let (status, title) = read_item_meta(&path)
                        .map(|(meta, _)| (meta.status, meta.title))
                        .unwrap_or((None, None));
                    let show_via = current.as_deref() != Some(label.as_str());
                    return SpaiLink {
                        id: reference.id.clone(),
                        project: reference.project.clone(),
                        status,
                        title,
                        path: Some(path),
                        via: show_via.then_some(label),
                    };
                }
            }
            SpaiLink {
                id: reference.id,
                project: reference.project,
                status: None,
                title: None,
                path: None,
                via: None,
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
                let via = link
                    .via
                    .as_deref()
                    .map(|project| format!(" [via {project}]"))
                    .unwrap_or_default();
                out.push_str(&format!("\n  {} [{}] {}{}", link.id, status, title, via));
            }
            (None, _) => {
                let where_tried = link
                    .project
                    .as_deref()
                    .map(|project| format!(" in {project}"))
                    .unwrap_or_default();
                out.push_str(&format!(
                    "\n  {} [unresolved] no docs/spai item found{}",
                    link.id, where_tried
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

    fn backlogs() -> Vec<(String, PathBuf)> {
        vec![
            ("pi-uma".to_string(), PathBuf::from("D:/uma/docs/spai")),
            (
                "pi-herdr-sidebar".to_string(),
                PathBuf::from("D:/sidebar/docs/spai"),
            ),
        ]
    }

    #[test]
    fn collect_refs_puts_the_structural_field_first() {
        let fact = fact_with("body mentions SPAI-036 and SPAI-035", &["SPAI-035"]);
        let ids: Vec<String> = collect_refs(&fact).into_iter().map(|r| r.id).collect();
        assert_eq!(ids, vec!["SPAI-035", "SPAI-036"]);
    }

    #[test]
    fn collect_refs_keeps_a_qualifier_from_the_field() {
        let fact = fact_with("", &["pi-herdr-sidebar/SPAI-012"]);
        let refs = collect_refs(&fact);
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].project.as_deref(), Some("pi-herdr-sidebar"));
        assert_eq!(refs[0].id, "SPAI-012");
    }

    #[test]
    fn collect_refs_ignores_facts_without_references() {
        assert!(collect_refs(&fact_with("no references here", &[])).is_empty());
    }

    #[test]
    fn a_qualified_reference_resolves_in_the_project_it_names() {
        let reference = SpaiRef {
            project: Some("pi-herdr-sidebar".to_string()),
            id: "SPAI-012".to_string(),
        };
        let dirs = target_dirs(&reference, Some("pi-uma"), &backlogs());
        assert_eq!(dirs[0].0, "pi-herdr-sidebar", "the named project wins");
        assert_eq!(dirs[0].1, PathBuf::from("D:/sidebar/docs/spai"));
    }

    #[test]
    fn a_bare_reference_tries_the_facts_own_project_first() {
        let reference = SpaiRef {
            project: None,
            id: "SPAI-012".to_string(),
        };
        let dirs = target_dirs(&reference, Some("pi-herdr-sidebar"), &backlogs());
        assert_eq!(dirs[0].0, "pi-herdr-sidebar");
        assert_eq!(dirs[1].0, "pi-uma", "then everything else");
    }

    #[test]
    fn an_unknown_qualifier_still_yields_a_diagnosable_target() {
        let reference = SpaiRef {
            project: Some("D:/elsewhere/other-proj".to_string()),
            id: "SPAI-012".to_string(),
        };
        let dirs = target_dirs(&reference, None, &backlogs());
        assert_eq!(dirs.len(), 1);
        assert_eq!(dirs[0].0, "other-proj");
        assert!(dirs[0].1.ends_with("docs\\spai") || dirs[0].1.ends_with("docs/spai"));
    }

    #[test]
    fn render_marks_direction_and_project() {
        let links = vec![
            SpaiLink {
                id: "SPAI-012".to_string(),
                project: Some("pi-herdr-sidebar".to_string()),
                status: Some("done".to_string()),
                title: Some("Sidebar relations".to_string()),
                path: Some(PathBuf::from("D:/sidebar/docs/spai/x.md")),
                via: Some("pi-herdr-sidebar".to_string()),
            },
            SpaiLink {
                id: "SPAI-999".to_string(),
                project: Some("pi-herdr-sidebar".to_string()),
                status: None,
                title: None,
                path: None,
                via: None,
            },
        ];
        let text = render_section(&links);
        assert!(text.contains("SPAI-012 [done] Sidebar relations [via pi-herdr-sidebar]"));
        assert!(
            text.contains("SPAI-999 [unresolved] no docs/spai item found in pi-herdr-sidebar"),
            "an unresolved cross-project reference must name where it looked: {text}"
        );
    }

    #[test]
    fn render_reports_absence_clearly() {
        assert!(render_section(&[]).contains("none declared"));
    }
}

//! Read-only SPAI backlog source (SPAI-036).
//!
//! SPAI is the volatile work ledger, UMA the durable knowledge base
//! (decision 01M4WY0WX6MAY62J6VHC51HV66): this module READS `docs/spai` item
//! files on demand and never copies them into the fact index, so task state can
//! never pollute recall, consolidation or the semantic store. A separate
//! `--source spai` query path is what keeps them out of default recall.
//!
//! Ranking is deliberately status-weighted: an open item outranks a finished
//! one, and a `cancelled` item decays hard — the "aggressive decay for
//! done/cancelled items" rule of the integration decision.

use std::path::{Path, PathBuf};

/// Frontmatter metadata of a SPAI item (never its whole body — callers that
/// need text read the file themselves).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SpaiItemMeta {
    pub status: Option<String>,
    pub title: Option<String>,
}

/// One backlog search hit. `score` is status-weighted, so it ranks items but is
/// not comparable across different queries.
#[derive(Debug, Clone, PartialEq)]
pub struct SpaiSearchHit {
    pub id: String,
    pub title: String,
    pub status: String,
    pub score: f64,
    pub snippet: String,
    pub file_path: PathBuf,
}

/// Canonical display form of a SPAI id (`SPAI-35` -> `SPAI-035`), so padding
/// never decides whether two references are the same item.
pub fn canonical_id(number: u64) -> String {
    format!("SPAI-{number:03}")
}

/// Extracts every `SPAI-<digits>` mention from free text, case-insensitive,
/// canonicalized and de-duplicated in first-seen order.
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

/// Finds the item file for a numeric SPAI id inside one directory. Matches on
/// the parsed number, not the string, so padding never matters.
pub fn find_item(dir: &Path, number: u64) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let wanted = canonical_id(number);
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !name.ends_with(".md") {
            continue;
        }
        if scan_ids(name).iter().any(|id| id == &wanted) {
            return Some(entry.path());
        }
    }
    None
}

/// Reads an item's frontmatter metadata and body. Returns `None` when the file
/// cannot be read; a missing frontmatter block is a clean empty metadata.
pub fn read_item_meta(path: &Path) -> Option<(SpaiItemMeta, String)> {
    let content = std::fs::read_to_string(path).ok()?;
    let (frontmatter, body) = split_frontmatter(&content);
    let mut meta = SpaiItemMeta::default();
    if let Some(frontmatter) = frontmatter {
        for line in frontmatter.lines() {
            if let Some(rest) = line.strip_prefix("status:") {
                meta.status = Some(unquote(rest));
            } else if let Some(rest) = line.strip_prefix("title:") {
                meta.title = Some(unquote(rest));
            }
        }
    }
    Some((meta, body.to_string()))
}

/// Splits `content` into (frontmatter, body). Frontmatter is `None` when the
/// document does not open with a `---` block.
fn split_frontmatter(content: &str) -> (Option<&str>, &str) {
    let Some(rest) = content
        .strip_prefix("---\r\n")
        .or_else(|| content.strip_prefix("---\n"))
    else {
        return (None, content);
    };
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end_matches(['\r', '\n']).trim() == "---" {
            return (Some(&rest[..offset]), &rest[offset + line.len()..]);
        }
        offset += line.len();
    }
    (None, content)
}

fn unquote(raw: &str) -> String {
    let value = raw.trim();
    let bytes = value.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\''))
    {
        value[1..value.len() - 1].to_string()
    } else {
        value.to_string()
    }
}

/// Ranking multiplier by lifecycle status: open work ranks first, finished work
/// decays, cancelled work decays hardest. Unknown statuses sit in the middle —
/// absence of a known status must never look like "open".
pub fn status_weight(status: &str) -> f64 {
    match status.trim().to_ascii_lowercase().as_str() {
        "todo" | "working" => 1.0,
        "waiting" => 0.9,
        "idea" | "note" => 0.8,
        "done" => 0.3,
        "cancelled" => 0.1,
        _ => 0.7,
    }
}

/// Concatenates body text around the first matching term without splitting a
/// UTF-8 character (Czech diacritics must not panic a byte slice).
fn snippet(body: &str, terms: &[String]) -> String {
    let text = collapse_whitespace(body);
    let lower = text.to_lowercase();
    let Some(anchor) = terms.iter().find_map(|term| lower.find(term)) else {
        return String::new();
    };
    let chars: Vec<char> = text.chars().collect();
    // Map the byte anchor (valid for `lower`) to a char index; char indices are
    // always safe to slice a Vec<char> with, unlike byte offsets.
    let char_start = lower[..anchor].chars().count();
    let start = char_start.saturating_sub(40);
    let end = (char_start + 80).min(chars.len());
    let window: String = chars[start..end].iter().collect();
    let prefix = if start > 0 { "…" } else { "" };
    let suffix = if end < chars.len() { "…" } else { "" };
    format!("{prefix}{}{suffix}", window.trim())
}

fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Searches one project's backlog directory, live from disk.
///
/// A missing or empty directory yields no hits; unreadable or malformed files
/// are skipped rather than failing the query.
pub fn search_backlog(dir: &Path, query: &str, limit: usize) -> Vec<SpaiSearchHit> {
    let terms: Vec<String> = {
        let mut terms: Vec<String> = query
            .split_whitespace()
            .map(|t| t.to_lowercase())
            .filter(|t| t.chars().count() >= 2)
            .collect();
        terms.dedup();
        terms
    };
    if terms.is_empty() {
        return Vec::new();
    }

    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut hits: Vec<SpaiSearchHit> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !path.is_file() || !name.ends_with(".md") || name.starts_with('.') {
            continue;
        }
        let Some((meta, body)) = read_item_meta(&path) else {
            continue;
        };
        let title = meta.title.unwrap_or_default();
        let status = meta.status.unwrap_or_default();
        let lower_title = title.to_lowercase();
        let lower_body = body.to_lowercase();

        let mut score = 0.0;
        for term in &terms {
            let title_hits = lower_title.matches(term.as_str()).count() as f64;
            let body_hits = lower_body.matches(term.as_str()).count() as f64;
            score += 3.0 * title_hits + body_hits;
        }
        if score == 0.0 {
            continue;
        }
        score *= status_weight(&status);

        let id = scan_ids(name)
            .first()
            .cloned()
            .unwrap_or_else(|| scan_ids(&title).first().cloned().unwrap_or_default());

        hits.push(SpaiSearchHit {
            id,
            title,
            status,
            score,
            snippet: snippet(&body, &terms),
            file_path: path,
        });
    }

    hits.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    });
    hits.truncate(limit);
    hits
}

#[cfg(test)]
mod tests;

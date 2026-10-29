//! Staging Area: isolated storage for shadow-worker drafts (Proposal 02).
//!
//! Drafts mined by the background shadow worker are kept in `.uma/.staging/<ULID>.json`
//! to prevent polluting the primary SQLite FTS5 search index or git commit history.
//! Once reviewed and approved by the operator, drafts are promoted to permanent OKF facts.

use std::path::PathBuf;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::domain::{Fact, FactId};
use crate::store::Store;

#[cfg(test)]
mod tests;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StagedProvenance {
    pub session_id: Option<String>,
    pub trigger_type: String,
    pub context: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StagedDraft {
    pub id: FactId,
    pub status: String,
    pub confidence: f64,
    pub provenance: StagedProvenance,
    pub fact: Fact,
}

impl StagedDraft {
    pub fn new(confidence: f64, provenance: StagedProvenance, fact: Fact) -> Self {
        Self {
            id: fact.id,
            status: "draft".to_string(),
            confidence,
            provenance,
            fact,
        }
    }
}

/// Returns the `.uma/.staging` directory path for a given store.
pub fn staging_dir(store: &Store) -> PathBuf {
    store.root.join(".staging")
}

/// Saves a staged draft as an atomic JSON file in `.uma/.staging/<ULID>.json`.
pub fn save_draft(store: &Store, draft: &StagedDraft) -> Result<PathBuf> {
    let dir = staging_dir(store);
    std::fs::create_dir_all(&dir)
        .with_context(|| format!("Failed to create staging directory {:?}", dir))?;

    let file_path = dir.join(format!("{}.json", draft.id.to_string().to_lowercase()));
    let json =
        serde_json::to_string_pretty(draft).context("Failed to serialize staged draft to JSON")?;

    std::fs::write(&file_path, json)
        .with_context(|| format!("Failed to write draft to {:?}", file_path))?;

    Ok(file_path)
}

/// A staging file that could not be read, with the reason. Callers surface
/// these instead of pretending the file does not exist.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkippedDraft {
    pub path: PathBuf,
    pub error: String,
}

/// The staging area as the operator should see it: the readable drafts plus
/// every file that failed to parse.
#[derive(Debug, Clone, Default)]
pub struct DraftListing {
    pub drafts: Vec<StagedDraft>,
    pub skipped: Vec<SkippedDraft>,
}

impl DraftListing {
    pub fn is_empty(&self) -> bool {
        self.drafts.is_empty()
    }

    pub fn len(&self) -> usize {
        self.drafts.len()
    }

    /// One-line warning naming the first unreadable file, or `None` when
    /// everything parsed. Never silent: an unreadable draft is a draft the
    /// operator cannot review.
    pub fn warning(&self) -> Option<String> {
        let first = self.skipped.first()?;
        Some(format!(
            "{} staging file(s) could not be read (first: {}: {}) — \
             legacy or corrupt drafts are reported here instead of being hidden.",
            self.skipped.len(),
            first.path.display(),
            first.error
        ))
    }
}

/// Lists all staged drafts from `.uma/.staging/`, sorted newest first.
///
/// A file that does not parse is REPORTED in `skipped`, never silently dropped:
/// a draft the operator cannot see is a draft they cannot review, and that is
/// exactly how 21 `muscle_synthesis` drafts written before the `spai` field
/// became invisible to `uma staging list` and the review modal.
pub fn list_drafts(store: &Store) -> Result<DraftListing> {
    let dir = staging_dir(store);
    if !dir.exists() {
        return Ok(DraftListing::default());
    }

    let mut listing = DraftListing::default();
    for entry in walkdir::WalkDir::new(&dir).into_iter().flatten() {
        if !entry.file_type().is_file() || entry.path().extension().is_none_or(|e| e != "json") {
            continue;
        }
        match std::fs::read_to_string(entry.path()) {
            Ok(content) => match serde_json::from_str::<StagedDraft>(&content) {
                Ok(draft) => listing.drafts.push(draft),
                Err(err) => listing.skipped.push(SkippedDraft {
                    path: entry.path().to_path_buf(),
                    error: err.to_string(),
                }),
            },
            Err(err) => listing.skipped.push(SkippedDraft {
                path: entry.path().to_path_buf(),
                error: err.to_string(),
            }),
        }
    }

    listing
        .drafts
        .sort_by_key(|d| std::cmp::Reverse(d.fact.validity.since));
    Ok(listing)
}

/// Loads a single staged draft by its FactId string (or filename).
pub fn load_draft(store: &Store, id_str: &str) -> Result<StagedDraft> {
    let dir = staging_dir(store);
    let needle = id_str.trim().to_lowercase();

    for entry in walkdir::WalkDir::new(&dir).into_iter().flatten() {
        if entry.file_type().is_file() && entry.path().extension().is_some_and(|e| e == "json") {
            let stem = entry
                .path()
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_lowercase();
            if stem == needle || stem.starts_with(&needle) {
                let content = std::fs::read_to_string(entry.path())?;
                let draft: StagedDraft = serde_json::from_str(&content)?;
                return Ok(draft);
            }
        }
    }

    anyhow::bail!("Staged draft '{}' not found in {:?}", id_str, dir)
}

/// Deletes a staged draft file from `.uma/.staging/`.
pub fn delete_draft(store: &Store, id_str: &str) -> Result<()> {
    let dir = staging_dir(store);
    let needle = id_str.trim().to_lowercase();

    for entry in walkdir::WalkDir::new(&dir).into_iter().flatten() {
        if entry.file_type().is_file() && entry.path().extension().is_some_and(|e| e == "json") {
            let stem = entry
                .path()
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_lowercase();
            if stem == needle || stem.starts_with(&needle) {
                std::fs::remove_file(entry.path())
                    .with_context(|| format!("Failed to delete draft {:?}", entry.path()))?;
                return Ok(());
            }
        }
    }

    anyhow::bail!("Draft '{}' not found to delete", id_str)
}

/// Promotes a staged draft to permanent OKF fact storage and deletes the draft.
pub fn approve_draft(store: &Store, id_str: &str) -> Result<Fact> {
    let draft = load_draft(store, id_str)?;
    let fact = draft.fact;

    store.write(&fact)?;
    let _ = delete_draft(store, id_str);

    Ok(fact)
}

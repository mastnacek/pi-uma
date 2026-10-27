//! Recall scoring thresholds, candidate pooling, and bilingual merging.

use anyhow::Result;
use std::collections::HashMap;
use uma_core::domain::FactId;
use uma_core::search::{SearchHit, SearchMode};
use uma_core::store::Store;

use super::{recall_query, RawCandidate, MIN_ABSOLUTE_SCORE, RELATIVE_SCORE_RATIO};

/// Check if bilingual candidate retrieval is enabled (env `UMA_RECALL_BILINGUAL`, default 1).
pub fn is_bilingual_enabled() -> bool {
    is_bilingual_enabled_from(std::env::var("UMA_RECALL_BILINGUAL").ok().as_deref())
}

pub fn is_bilingual_enabled_from(val: Option<&str>) -> bool {
    val.map(|v| v.trim() != "0").unwrap_or(true)
}

/// Evaluates whether a score passes the recall quality gate:
/// 1. Must be strictly positive (> 0.0)
/// 2. Must meet or exceed the absolute minimum threshold (`MIN_ABSOLUTE_SCORE`)
/// 3. Must meet or exceed the relative score threshold (~50% of `best_score`)
pub fn passes_recall_threshold(score: f64, best_score: f64) -> bool {
    if score.is_nan() || score <= 0.0 {
        return false;
    }
    if score < MIN_ABSOLUTE_SCORE {
        return false;
    }
    if score < best_score * RELATIVE_SCORE_RATIO {
        return false;
    }
    true
}

/// Reads the body of a fact from disk, store, or falls back to hit snippet.
pub fn get_fact_body(hit: &SearchHit) -> String {
    if let Some(ref path) = hit.file_path {
        if let Ok(content) = std::fs::read_to_string(path) {
            if let Ok(fact) = uma_core::serialization::markdown_to_fact(&content) {
                return fact.body;
            }
        }
    }
    if let Ok(fact) = Store::find_by_id(&hit.id) {
        return fact.body;
    }
    hit.snippet.clone()
}

/// Formats a preview of the fact body (~400 characters) for relevance evaluation.
pub fn get_fact_body_preview(hit: &SearchHit) -> String {
    get_fact_body(hit).trim().chars().take(400).collect()
}

/// Recalls a pool of candidates for a single prompt string, applying
/// sorting and absolute + relative thresholds.
pub(crate) fn retrieve_candidate_pool(
    prompt: &str,
    exclude: &[String],
    max_candidates: usize,
) -> Result<(Vec<RawCandidate>, Option<String>)> {
    let query = recall_query(prompt);
    let outcome = Store::search_all(
        &query,
        None,
        None,
        SearchMode::Keyword,
        false,
        None,
        exclude,
        16,
    )?;

    let degraded_note = outcome.note();
    let mut raw_candidates: Vec<RawCandidate> = outcome
        .hits
        .into_iter()
        .map(|hit| RawCandidate { hit })
        .collect();

    raw_candidates.sort_by(|a, b| {
        b.hit
            .score
            .partial_cmp(&a.hit.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let best_score = raw_candidates.first().map(|c| c.hit.score).unwrap_or(0.0);
    let mut pool: Vec<RawCandidate> = Vec::new();

    if best_score >= MIN_ABSOLUTE_SCORE {
        for c in raw_candidates {
            if pool.len() >= max_candidates {
                break;
            }
            if passes_recall_threshold(c.hit.score, best_score) {
                pool.push(c);
            }
        }
    }

    Ok((pool, degraded_note))
}

/// Merges primary and alternative candidate pools by fact ID, taking the maximum score,
/// and returns up to `limit` candidates sorted by score descending.
pub(crate) fn merge_candidate_pools(
    primary: Vec<RawCandidate>,
    alt: Vec<RawCandidate>,
    limit: usize,
) -> Vec<RawCandidate> {
    let mut map: HashMap<FactId, RawCandidate> = HashMap::new();
    for c in primary {
        map.insert(c.hit.id, c);
    }
    for c in alt {
        match map.get_mut(&c.hit.id) {
            Some(existing) => {
                if c.hit.score > existing.hit.score {
                    *existing = c;
                }
            }
            None => {
                map.insert(c.hit.id, c);
            }
        }
    }

    let mut merged: Vec<RawCandidate> = map.into_values().collect();
    merged.sort_by(|a, b| {
        b.hit
            .score
            .partial_cmp(&a.hit.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    merged.truncate(limit);
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bilingual_enabled_default() {
        assert!(is_bilingual_enabled_from(None));
        assert!(!is_bilingual_enabled_from(Some("0")));
        assert!(is_bilingual_enabled_from(Some("1")));
    }

    #[test]
    fn test_passes_recall_threshold() {
        assert!(passes_recall_threshold(15.0, 20.0));
        assert!(passes_recall_threshold(12.0, 15.0));
        assert!(!passes_recall_threshold(11.9, 15.0));
        assert!(!passes_recall_threshold(12.0, 25.0)); // 12.0 < 25.0 * 0.5 (12.5)
    }

    #[test]
    fn test_merge_candidate_pools() {
        let id1 = FactId::new();
        let id2 = FactId::new();
        let id3 = FactId::new();

        let make_cand = |id: FactId, score: f64| RawCandidate {
            hit: SearchHit {
                id,
                title: "Test".to_string(),
                description: None,
                fact_type: uma_core::domain::FactType::Decision,
                scope: uma_core::domain::Scope::Global,
                project_name: "global".to_string(),
                status: uma_core::domain::FactStatus::Stable,
                supersedes: None,
                score,
                snippet: "Snippet".to_string(),
                tags: vec![],
                file_path: None,
            },
        };

        let primary = vec![make_cand(id1.clone(), 15.0), make_cand(id2.clone(), 10.0)];
        let alt = vec![make_cand(id2.clone(), 18.0), make_cand(id3.clone(), 14.0)];

        let merged = merge_candidate_pools(primary, alt, 8);
        assert_eq!(merged.len(), 3);
        // id2 should have max score (18.0) and be first
        assert_eq!(merged[0].hit.id, id2);
        assert_eq!(merged[0].hit.score, 18.0);
        // id1 should be second (15.0)
        assert_eq!(merged[1].hit.id, id1);
        assert_eq!(merged[1].hit.score, 15.0);
        // id3 should be third (14.0)
        assert_eq!(merged[2].hit.id, id3);
        assert_eq!(merged[2].hit.score, 14.0);
    }
}

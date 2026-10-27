use anyhow::Result;
use uma_core::fastbrain;
use uma_core::search::{SearchHit, SearchMode};
use uma_core::store::Store;

use super::{
    emit, recall_facts, recall_query, CheckArgs, RawCandidate, RecallVerdict,
};

/// Reads a preview of the fact (title + description if any + body preview ~400 characters)
/// for relevance evaluation.
fn get_fact_body_preview(hit: &SearchHit) -> String {
    let mode = std::env::var("UMA_RECALL_PREVIEW").unwrap_or_else(|_| "full".to_string());

    let (desc, body) = if let Some(ref path) = hit.file_path {
        if let Ok(content) = std::fs::read_to_string(path) {
            if let Ok(fact) = uma_core::serialization::markdown_to_fact(&content) {
                (fact.description, fact.body)
            } else {
                (hit.description.clone(), hit.snippet.clone())
            }
        } else {
            (hit.description.clone(), hit.snippet.clone())
        }
    } else if let Ok(fact) = Store::find_by_id(&hit.id) {
        (fact.description, fact.body)
    } else {
        (hit.description.clone(), hit.snippet.clone())
    };

    let body_prev: String = body.trim().chars().take(400).collect();
    if mode == "body" {
        return body_prev;
    }

    let mut parts = Vec::new();
    parts.push(format!("Title: {}", hit.title));
    if let Some(d) = desc.as_ref().filter(|s| !s.trim().is_empty()) {
        parts.push(format!("Description: {}", d.trim()));
    }
    parts.push(format!("Body: {}", body_prev));
    parts.join("\n")
}

fn env_f64(key: &str) -> Option<f64> {
    std::env::var(key).ok().and_then(|v| v.parse::<f64>().ok())
}

fn passes_pool_threshold(score: f64, best_score: f64) -> bool {
    let min_score = env_f64("UMA_RELEVANCE_MIN_SCORE").unwrap_or(super::MIN_ABSOLUTE_SCORE);
    let ratio = env_f64("UMA_RELEVANCE_REL_RATIO").unwrap_or(super::RELATIVE_SCORE_RATIO);
    !score.is_nan() && score > 0.0 && score >= min_score && score >= best_score * ratio
}

/// Executes recall check in `jev-relevance` mode:
/// 1. Retrieval as `--judge always` (threshold 12, relative threshold, domains), pool of up to 8 candidates.
/// 2. Single Decisions API request to evaluate relevance of each candidate.
/// 3. Filter candidates with `p >= threshold` (env `UMA_RELEVANCE_MIN_PROB` and `--min-prob`, default 0.5),
///    sorted by p descending, max `--max`. Add "relevance": p to the JSON of each fact.
/// 4. Failure/timeout 5s -> return results as `--judge always` with note "relevance judge degraded".
pub(crate) fn check_prompt(args: CheckArgs) -> Result<()> {
    let prompt = args.prompt.join(" ");
    let query = recall_query(&prompt);

    // Retrieve pool of candidates using BM25 and domain filtering
    let outcome = Store::search_all(
        &query,
        None,
        None,
        SearchMode::Keyword,
        false,
        None,
        &args.exclude,
        16,
    )?;

    let degraded_note = outcome.note();
    let mut raw_candidates: Vec<RawCandidate> = outcome
        .hits
        .into_iter()
        .map(|hit| RawCandidate {
            hit,
            degraded_note: degraded_note.clone(),
        })
        .collect();

    raw_candidates.sort_by(|a, b| {
        b.hit
            .score
            .partial_cmp(&a.hit.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let best_score = raw_candidates.first().map(|c| c.hit.score).unwrap_or(0.0);

    let mut candidate_pool: Vec<RawCandidate> = Vec::new();
    for c in raw_candidates {
        if candidate_pool.len() >= 8 {
            break;
        }
        if passes_pool_threshold(c.hit.score, best_score) {
            candidate_pool.push(c);
        }
    }

    // Hybrid pool: supplement with up to 4 semantic candidates (cosine similarity >= min_cos)
    let semantic_enabled = std::env::var("UMA_RECALL_SEMANTIC")
        .map(|v| v.trim() != "0")
        .unwrap_or(true);
    let min_cos = env_f64("UMA_RECALL_SEMANTIC_MIN_COS").unwrap_or(0.45);

    if semantic_enabled {
        if let Ok(sem_hits) = Store::search_semantic_pool(
            &query,
            &args.exclude,
            8,
            std::time::Duration::from_millis(1500),
        ) {
            for hit in sem_hits.into_iter().filter(|h| h.score >= min_cos).take(4) {
                if candidate_pool.len() >= 8 {
                    break;
                }
                if !candidate_pool.iter().any(|c| c.hit.id == hit.id) {
                    candidate_pool.push(RawCandidate {
                        hit,
                        degraded_note: None,
                    });
                }
            }
        }
    }

    if candidate_pool.is_empty() {
        return emit(
            &RecallVerdict {
                search: false,
                judged_by: "jev-relevance".to_string(),
                fact_types: Vec::new(),
                probability: Vec::new(),
                recalled: 0,
                facts: Vec::new(),
                note: degraded_note,
            },
            args.json,
        );
    }

    let rel_cands: Vec<fastbrain::relevance::CandidateForRelevance> = candidate_pool
        .iter()
        .map(|c| fastbrain::relevance::CandidateForRelevance {
            id: c.hit.id.to_string(),
            title: c.hit.title.clone(),
            body_preview: get_fact_body_preview(&c.hit),
        })
        .collect();

    let relevance_res = fastbrain::relevance::judge_relevance(&prompt, &rel_cands);

    match relevance_res {
        Err(_) => {
            // Failure/timeout -> return results using already loaded candidates without re-triggering search
            let fallback_mode =
                std::env::var("UMA_RECALL_FALLBACK").unwrap_or_else(|_| "cached".to_string());
            let (facts, note) = if fallback_mode == "reissue" {
                let (f, search_notes) = recall_facts(&prompt, args.max, &args.exclude)?;
                let n = if search_notes.is_empty() {
                    Some("relevance judge degraded".to_string())
                } else {
                    Some(format!(
                        "relevance judge degraded; {}",
                        search_notes.join("; ")
                    ))
                };
                (f, n)
            } else {
                let mut f = Vec::new();
                for cand in candidate_pool.iter().take(args.max) {
                    f.push(serde_json::json!({
                        "id": cand.hit.id,
                        "title": cand.hit.title,
                        "fact_type": cand.hit.fact_type,
                        "scope": cand.hit.scope,
                        "score": cand.hit.score,
                        "snippet": cand.hit.snippet,
                        "tags": cand.hit.tags,
                    }));
                }
                let mut search_notes = vec!["relevance judge degraded".to_string()];
                if let Some(dn) = degraded_note {
                    if !search_notes.contains(&dn) {
                        search_notes.push(dn);
                    }
                }
                (f, Some(search_notes.join("; ")))
            };

            emit(
                &RecallVerdict {
                    search: !facts.is_empty(),
                    judged_by: "jev-relevance".to_string(),
                    fact_types: Vec::new(),
                    probability: Vec::new(),
                    recalled: facts.len(),
                    facts,
                    note,
                },
                args.json,
            )
        }
        Ok(probs) => {
            let threshold = fastbrain::resolve_relevance_min_prob(args.min_prob);
            let mut retained: Vec<(f64, serde_json::Value)> = Vec::new();
            let mut search_notes = Vec::new();
            if let Some(note) = degraded_note {
                search_notes.push(note);
            }

            for (cand, &p) in candidate_pool.iter().zip(probs.iter()) {
                if p >= threshold {
                    retained.push((
                        p,
                        serde_json::json!({
                            "id": cand.hit.id,
                            "title": cand.hit.title,
                            "fact_type": cand.hit.fact_type,
                            "scope": cand.hit.scope,
                            "score": cand.hit.score,
                            "snippet": cand.hit.snippet,
                            "tags": cand.hit.tags,
                            "relevance": p,
                        }),
                    ));
                }
            }

            retained.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

            retained.truncate(args.max);

            let facts: Vec<serde_json::Value> = retained.into_iter().map(|(_, f)| f).collect();
            let search = !facts.is_empty();
            let note = if search_notes.is_empty() {
                None
            } else {
                Some(search_notes.join("; "))
            };

            emit(
                &RecallVerdict {
                    search,
                    judged_by: "jev-relevance".to_string(),
                    fact_types: Vec::new(),
                    probability: probs,
                    recalled: facts.len(),
                    facts,
                    note,
                },
                args.json,
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_passes_pool_threshold_default() {
        let best = 20.0;
        assert!(passes_pool_threshold(20.0, best));
        assert!(passes_pool_threshold(12.0, best));
        assert!(!passes_pool_threshold(11.9, best));
        assert!(!passes_pool_threshold(9.9, best));

        let best_high = 30.0;
        // 50% of 30 is 15.0
        assert!(!passes_pool_threshold(14.0, best_high));
        assert!(passes_pool_threshold(15.0, best_high));
    }

    #[test]
    fn test_get_fact_body_preview_formatting() {
        let hit = SearchHit {
            id: uma_core::domain::FactId::new(),
            title: "Export agents order".to_string(),
            description: Some("Order of execution".to_string()),
            fact_type: uma_core::domain::FactType::Decision,
            scope: uma_core::domain::Scope::Global,
            project_name: "global".to_string(),
            status: uma_core::domain::FactStatus::Stable,
            supersedes: None,
            score: 15.0,
            snippet: "The pipeline runs ExportDXL first then sync.".to_string(),
            tags: vec![],
            file_path: None,
        };

        let preview = get_fact_body_preview(&hit);
        assert!(preview.contains("Title: Export agents order"));
        assert!(preview.contains("Description: Order of execution"));
        assert!(preview.contains("Body: The pipeline runs ExportDXL first then sync."));
    }
}

use anyhow::Result;
use uma_core::fastbrain;

use super::{
    emit, get_fact_body_preview, is_bilingual_enabled, is_semantic_fallback_enabled,
    merge_candidate_pools, retrieve_candidate_pool, retrieve_semantic_pool, CheckArgs,
    RecallVerdict,
};

/// Executes recall check in `jev-relevance` mode:
/// 1. Retrieval as `--judge always` (threshold 12, relative threshold, domains), pool of up to 8 candidates.
///    If bilingual is enabled and --alt-prompt is given, retrieves pools for both and merges by id (max score).
/// 2. Single Decisions API request to evaluate relevance of each candidate against primary prompt.
/// 3. Filter candidates with `p >= threshold` (env `UMA_RELEVANCE_MIN_PROB` and `--min-prob`, default 0.5),
///    sorted by p descending, max `--max`. Add "relevance": p to the JSON of each fact.
/// 4. Failure/timeout 5s -> return results from candidate pool with note "relevance judge degraded".
pub(crate) fn check_prompt(args: CheckArgs) -> Result<()> {
    let prompt = args.prompt.join(" ");

    // Retrieve pool of candidates using BM25 and domain filtering
    let (cands_primary, note_primary) = retrieve_candidate_pool(&prompt, &args.exclude, 8)?;
    let (candidate_pool, degraded_note) = if is_bilingual_enabled()
        && args
            .alt_prompt
            .as_deref()
            .map(|s: &str| !s.trim().is_empty())
            .unwrap_or(false)
    {
        let alt_text = args.alt_prompt.as_deref().unwrap().trim();
        let (cands_alt, note_alt) = retrieve_candidate_pool(alt_text, &args.exclude, 8)?;
        let merged = merge_candidate_pools(cands_primary, cands_alt, 8);
        let note = match (note_primary, note_alt) {
            (Some(n1), Some(n2)) if n1 == n2 => Some(n1),
            (Some(n1), Some(n2)) => Some(format!("{n1}; {n2}")),
            (Some(n), None) | (None, Some(n)) => Some(n),
            (None, None) => None,
        };
        (merged, note)
    } else {
        (cands_primary, note_primary)
    };

    // Opt-in semantic fallback: only when the keyword pool found nothing.
    let fallback = args.semantic_fallback || is_semantic_fallback_enabled();
    let used_semantic = candidate_pool.is_empty() && fallback;
    let (candidate_pool, degraded_note) = if used_semantic {
        let (sem, sem_note) = retrieve_semantic_pool(&prompt, &args.exclude, 8)?;
        let note = match (degraded_note, sem_note) {
            (Some(a), Some(b)) => Some(format!("{a}; semantic fallback: {b}")),
            (a, b) => a.or(b.map(|b| format!("semantic fallback: {b}"))),
        };
        (sem, note)
    } else {
        (candidate_pool, degraded_note)
    };

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
            // Failure/timeout -> return results from candidate pool with note "relevance judge degraded"
            let facts: Vec<serde_json::Value> = candidate_pool
                .iter()
                .take(args.max)
                .map(|cand| {
                    serde_json::json!({
                        "id": cand.hit.id,
                        "title": cand.hit.title,
                        "fact_type": cand.hit.fact_type,
                        "scope": cand.hit.scope,
                        "score": cand.hit.score,
                        "snippet": cand.hit.snippet,
                        "tags": cand.hit.tags,
                    })
                })
                .collect();
            let note = match degraded_note {
                Some(n) => Some(format!("relevance judge degraded; {n}")),
                None => Some("relevance judge degraded".to_string()),
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

            // Second chance: the judge rejected every keyword candidate (a
            // synonym miss — "monetary amounts" vs a fact about "money"). With
            // the fallback allowed, judge the standout semantic neighbours
            // that were not already judged.
            if retained.is_empty() && fallback && !used_semantic {
                let mut judged: Vec<String> = args.exclude.clone();
                judged.extend(candidate_pool.iter().map(|c| c.hit.id.to_string()));
                let (sem, _sem_note) = retrieve_semantic_pool(&prompt, &judged, 8)?;
                if !sem.is_empty() {
                    let sem_cands: Vec<fastbrain::relevance::CandidateForRelevance> = sem
                        .iter()
                        .map(|c| fastbrain::relevance::CandidateForRelevance {
                            id: c.hit.id.to_string(),
                            title: c.hit.title.clone(),
                            body_preview: get_fact_body_preview(&c.hit),
                        })
                        .collect();
                    if let Ok(sem_probs) = fastbrain::relevance::judge_relevance(&prompt, &sem_cands) {
                        for (cand, &p) in sem.iter().zip(sem_probs.iter()) {
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
                        if !retained.is_empty() {
                            search_notes.push("semantic fallback after keyword candidates were rejected".to_string());
                        }
                    }
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

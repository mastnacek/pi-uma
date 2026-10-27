use anyhow::Result;
use uma_core::fastbrain;
use uma_core::search::{SearchHit, SearchMode};
use uma_core::store::Store;

use super::{
    emit, passes_recall_threshold, recall_facts, recall_query, CheckArgs, RawCandidate,
    RecallVerdict,
};

/// Reads a preview of the fact body (~400 characters) for relevance evaluation.
fn get_fact_body_preview(hit: &SearchHit) -> String {
    if let Some(ref path) = hit.file_path {
        if let Ok(content) = std::fs::read_to_string(path) {
            if let Ok(fact) = uma_core::serialization::markdown_to_fact(&content) {
                return fact.body.trim().chars().take(400).collect();
            }
        }
    }
    if let Ok(fact) = Store::find_by_id(&hit.id) {
        return fact.body.trim().chars().take(400).collect();
    }
    hit.snippet.chars().take(400).collect()
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
        if passes_recall_threshold(c.hit.score, best_score) {
            candidate_pool.push(c);
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
            // Failure/timeout -> return results as --judge always with note "relevance judge degraded"
            let (facts, search_notes) = recall_facts(&prompt, args.max, &args.exclude)?;
            let note = if search_notes.is_empty() {
                Some("relevance judge degraded".to_string())
            } else {
                Some(format!(
                    "relevance judge degraded; {}",
                    search_notes.join("; ")
                ))
            };
            emit(
                &RecallVerdict {
                    search: true,
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

            retained.sort_by(|a, b| {
                b.0.partial_cmp(&a.0)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });

            retained.truncate(args.max);

            let facts: Vec<serde_json::Value> =
                retained.into_iter().map(|(_, f)| f).collect();
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

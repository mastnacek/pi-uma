//! Recall-slice spreading activation: pre-activates associative neighbors
//! of direct hits, subject to the same quality thresholds.

use super::passes_recall_threshold;
use uma_core::domain::{Fact, FactId};
use uma_core::store::Store;

/// Spreads activation from the direct hits and appends the strongest
/// pre-activated neighbors, subject to the same threshold as direct hits.
#[allow(dead_code)]
pub fn prime_neighbors(
    mut facts: Vec<serde_json::Value>,
    best_score: f64,
    max: usize,
    notes: &mut Vec<String>,
    exclude: &[String],
) -> Vec<serde_json::Value> {
    if facts.is_empty() || facts.len() >= max {
        return facts;
    }

    let hits_with_scores: Vec<(String, f64)> = facts
        .iter()
        .filter_map(|f| {
            let id = f.get("id").and_then(|v| v.as_str()).map(String::from)?;
            let score = f.get("score").and_then(|v| v.as_f64()).unwrap_or(0.0);
            Some((id, score))
        })
        .collect();

    // Load the facts behind the hits so the graph can be built.
    let mut hit_facts = Vec::new();
    for (id, _) in &hits_with_scores {
        if let Ok(fact_id) = id.parse::<FactId>() {
            if let Ok(fact) = Store::find_by_id(&fact_id) {
                hit_facts.push(fact);
            }
        }
    }
    if hit_facts.is_empty() {
        return facts;
    }

    // The graph MUST span the active context (current project + global store),
    // not foreign project stores from all_known_roots.
    let mut graph_facts: Vec<Fact> = Vec::new();
    let mut roots = Vec::new();
    if let Ok(global) = Store::global_root_path() {
        if global.exists() {
            roots.push(global);
        }
    }
    if let Ok(git_root) = Store::find_git_root() {
        let project_uma = git_root.join(".uma");
        if project_uma.exists() && !roots.contains(&project_uma) {
            roots.push(project_uma);
        }
    }
    for root in roots {
        if let Ok(all) = Store::new(root).list_all() {
            graph_facts.extend(all);
        }
    }
    for fact in &hit_facts {
        if !graph_facts.iter().any(|f| f.id == fact.id) {
            graph_facts.push(fact.clone());
        }
    }

    let graph = uma_core::priming::AssociationGraph::build(&graph_facts);
    let mut seen: Vec<String> = hits_with_scores.iter().map(|(id, _)| id.clone()).collect();
    let mut primed_candidates: Vec<(f64, f64, Fact)> = Vec::new();

    for (hit_id, hit_score) in &hits_with_scores {
        for activated in graph.spread(hit_id, 0.5, 1) {
            if seen.contains(&activated.id) || activated.id == *hit_id {
                continue;
            }
            if exclude.iter().any(|id| id == &activated.id) {
                continue;
            }
            // Scale activation (0..1) by the source hit's score so neighbor scores
            // are on the exact same scale as direct hits and pass the same quality gate.
            let neighbor_score = hit_score * activated.activation;
            if !passes_recall_threshold(neighbor_score, best_score) {
                continue;
            }
            if let Ok(fact_id) = activated.id.parse::<FactId>() {
                if let Ok(neighbor) = Store::find_by_id(&fact_id) {
                    seen.push(activated.id.clone());
                    if let Some(existing) = primed_candidates
                        .iter_mut()
                        .find(|(_, _, f)| f.id == neighbor.id)
                    {
                        if neighbor_score > existing.0 {
                            existing.0 = neighbor_score;
                            existing.1 = activated.activation;
                        }
                    } else {
                        primed_candidates.push((neighbor_score, activated.activation, neighbor));
                    }
                }
            }
        }
    }

    primed_candidates.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let initial_count = facts.len();
    for (neighbor_score, activation, neighbor) in primed_candidates {
        if facts.len() >= max {
            break;
        }
        facts.push(serde_json::json!({
            "id": neighbor.id,
            "title": neighbor.title,
            "fact_type": neighbor.fact_type.to_string(),
            "scope": neighbor.scope.to_string(),
            "score": neighbor_score,
            "snippet": format!("[primed {:.2}] {}", activation, neighbor.body.lines().next().unwrap_or("")),
            "tags": neighbor.tags,
        }));
    }

    if facts.len() > initial_count {
        notes.push("primed neighbors included (spreading activation)".to_string());
    }
    facts
}

//! Priming & spreading activation (Proposal 05, Pillar II).
//!
//! When the brain catches a stimulus ("car"), neurons send weak excitation to
//! neighboring nodes (wheels, engine, road). UMA mirrors this: an association
//! graph over facts (links, shared tags, file co-mentions) pre-activates
//! related facts BEFORE any full-text or vector query runs, so a recall that
//! later fires finds its neighbors already warm.
//!
//! **Deterministic and offline by construction** — graph edges derive from the
//! facts themselves (links, tags, file-path co-mention), never from a model.
//! The output is an activation-ordered fact-id list; the caller (recall gate,
//! immune L1 cache) decides what to do with it.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::domain::Fact;

#[cfg(test)]
mod tests;

/// One node's activation state.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ActivatedFact {
    pub id: String,
    pub title: String,
    /// Activation energy 0.0–1.0 (normalized; source fact = 1.0).
    pub activation: f64,
    /// How the fact was reached: direct stimulus or spread through the graph.
    pub path: String,
}

/// The association graph, built once per fact set and cached by the caller.
#[derive(Debug, Default)]
pub struct AssociationGraph {
    /// fact id → ids of associated facts (undirected, deduplicated).
    adjacency: HashMap<String, Vec<String>>,
    /// fact id → index position for O(1) lookups.
    index: HashMap<String, usize>,
    nodes: Vec<String>,
}

impl AssociationGraph {
    /// Builds the graph from a fact set: undirected edges for explicit `links`,
    /// shared tags (≥1), and file co-mentions (same path or stem).
    pub fn build(facts: &[Fact]) -> Self {
        let mut graph = Self::default();
        let now = chrono::Utc::now();

        for fact in facts {
            if !fact.is_active_at(now) {
                continue;
            }
            graph.index.insert(fact.id.to_string(), graph.nodes.len());
            graph.nodes.push(fact.id.to_string());
            graph.adjacency.insert(fact.id.to_string(), Vec::new());
        }

        let active: Vec<&Fact> = facts.iter().filter(|f| fact_is_active(f, now)).collect();

        for i in 0..active.len() {
            for j in (i + 1)..active.len() {
                if let Some(weight) = association_strength(active[i], active[j]) {
                    connect(&mut graph, &active[i].id.to_string(), &active[j].id.to_string(), weight);
                }
            }
        }

        graph
    }

    /// Spreads activation from a source fact through the graph.
    ///
    /// `decay` multiplies energy at each hop (0.5 = halve per hop, like the
    /// synaptic half-life). The source starts at 1.0; a node keeps its strongest
    /// arriving energy. `max_hops` bounds the walk.
    pub fn spread(
        &self,
        source: &str,
        decay: f64,
        max_hops: usize,
    ) -> Vec<ActivatedFact> {
        let Some(start_pos) = self.index.get(source) else {
            return Vec::new();
        };
        let start = &self.nodes[*start_pos];

        let mut energy: HashMap<&str, (f64, String)> = HashMap::new();
        energy.insert(start.as_str(), (1.0, "source".to_string()));

        let mut frontier: Vec<(&str, f64, usize)> = vec![(start.as_str(), 1.0, 0)];
        while let Some((node, e, hop)) = frontier.pop() {
            if hop >= max_hops {
                continue;
            }
            let next_energy = e * decay;
            if next_energy < 0.05 {
                continue; // below activation threshold: not worth spreading
            }
            for neighbor in self.adjacency.get(node).into_iter().flatten() {
                let entry = energy.entry(neighbor.as_str()).or_insert((0.0, String::new()));
                if next_energy > entry.0 {
                    entry.0 = next_energy;
                    entry.1 = format!("via {node}");
                    frontier.push((neighbor.as_str(), next_energy, hop + 1));
                }
            }
        }

        let mut out: Vec<ActivatedFact> = energy
            .into_iter()
            .map(|(id, (activation, path))| ActivatedFact {
                id: id.to_string(),
                title: String::new(),
                activation,
                path,
            })
            .collect();
        out.sort_by(|a, b| b.activation.partial_cmp(&a.activation).unwrap_or(std::cmp::Ordering::Equal));
        out
    }

    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    pub fn edge_count(&self) -> usize {
        self.adjacency.values().map(|v| v.len()).sum::<usize>() / 2
    }
}

fn fact_is_active(fact: &Fact, now: chrono::DateTime<chrono::Utc>) -> bool {
    fact.is_active_at(now)
}

fn connect(graph: &mut AssociationGraph, a: &str, b: &str, _weight: f64) {
    let list_a = graph.adjacency.entry(a.to_string()).or_default();
    if !list_a.iter().any(|x| x == b) {
        list_a.push(b.to_string());
    }
    let list_b = graph.adjacency.entry(b.to_string()).or_default();
    if !list_b.iter().any(|x| x == a) {
        list_b.push(a.to_string());
    }
}

/// The association strength between two facts; None means no edge.
///
/// Deterministic: explicit `links` beat shared tags; file co-mention is the
/// weakest (but most useful during coding) signal.
fn association_strength(a: &Fact, b: &Fact) -> Option<f64> {
    // Explicit link is the strongest association.
    if a.links.iter().any(|l| *l == b.id) || b.links.iter().any(|l| *l == a.id) {
        return Some(1.0);
    }

    // Shared tags.
    let tags_a: HashSet<&String> = a.tags.iter().collect();
    let shared_tags = b.tags.iter().filter(|t| tags_a.contains(t)).count();
    if shared_tags > 0 {
        return Some(0.7 + 0.1 * (shared_tags.min(3) - 1) as f64);
    }

    // File co-mention: same path stem in title or body.
    if file_stems(a).iter().any(|stem| file_stems(b).contains(stem)) {
        return Some(0.5);
    }

    None
}

/// Extracts plausible file-path stems from a fact's text.
fn file_stems(fact: &Fact) -> Vec<String> {
    let text = format!("{} {}", fact.title, fact.body);
    let mut stems = Vec::new();
    for token in text.split(|c: char| !c.is_alphanumeric() && c != '/' && c != '.' && c != '_') {
        if token.contains('/') && token.ends_with(".rs") || token.ends_with(".ts") || token.ends_with(".py") {
            if let Some(stem) = std::path::Path::new(token).file_stem().and_then(|s| s.to_str()) {
                if !stem.is_empty() {
                    stems.push(stem.to_string());
                }
            }
        }
    }
    stems
}
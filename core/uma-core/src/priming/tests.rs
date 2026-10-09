use super::*;
use crate::domain::{Fact, FactId, FactType, Scope};

fn fact(title: &str, body: &str, tags: &[&str]) -> Fact {
    let mut f = Fact::new(
        Scope::Project("p".to_string()),
        FactType::Pattern,
        title.to_string(),
        body.to_string(),
    );
    f.tags = tags.iter().map(|t| (*t).to_string()).collect();
    f
}

#[test]
fn test_shared_tags_create_edges() {
    let a = fact("Store tests use tempdir", "Never mock Store.", &["testing"]);
    let b = fact("Cargo test gate", "Run tests before push.", &["testing"]);
    let unrelated = fact("OAuth sign-in", "Google OAuth.", &["auth"]);

    let graph = AssociationGraph::build(&[a, b.clone(), unrelated]);
    assert_eq!(graph.node_count(), 3);
    assert_eq!(graph.edge_count(), 1, "only the shared-tag pair connects");

    let spread = graph.spread(&b.id.to_string(), 0.5, 3);
    assert_eq!(spread[0].id, b.id.to_string());
    assert_eq!(spread[0].activation, 1.0);
    assert_eq!(spread.len(), 2, "the unrelated fact stays cold");
}

#[test]
fn test_spread_activation_decays_by_hop() {
    // Chain: a ↔ b (tags), b ↔ c (different tag, same file stem)
    let a = fact("Alpha", "covers indexer/mod.rs", &["t1"]);
    let mut b = fact("Beta", "Beta rule", &["t1"]);
    b.body = "mentions indexer/mod.rs too".to_string();
    let c = fact("Gamma", "also indexer/mod.rs", &["t2"]);

    let c_id = c.id.to_string();
    let graph = AssociationGraph::build(&[a, b.clone(), c]);
    let spread = graph.spread(&b.id.to_string(), 0.5, 3);

    assert_eq!(spread.len(), 3, "whole connected component warms up");
    let c_energy = spread.iter().find(|f| f.id == c_id).unwrap();
    assert_eq!(c_energy.activation, 0.5, "one hop halves the energy");
    assert!(c_energy.path.contains("via"));
}

#[test]
fn test_explicit_links_give_strongest_edge() {
    let mut a = fact("A", "body", &[]);
    let b = fact("B", "body", &[]);
    a.links = vec![b.id];

    let graph = AssociationGraph::build(&[a, b.clone()]);
    assert_eq!(graph.edge_count(), 1);

    let spread = graph.spread(&b.id.to_string(), 0.9, 1);
    assert_eq!(spread.len(), 2);
}

#[test]
fn test_deprecated_facts_stay_cold() {
    let mut a = fact("A", "body", &["t"]);
    let b = fact("B", "body", &["t"]);
    use chrono::Utc;
    a.status = crate::domain::FactStatus::Deprecated;
    a.validity.until = Some(Utc::now());

    let graph = AssociationGraph::build(&[a, b.clone()]);
    let spread = graph.spread(&b.id.to_string(), 0.9, 3);
    assert_eq!(spread.len(), 1, "deprecated nodes are excluded from the graph");
}

#[test]
fn test_unknown_source_is_empty() {
    let a = fact("A", "body", &[]);
    let graph = AssociationGraph::build(&[a]);
    assert!(graph.spread("01UNKNOWN", 0.5, 3).is_empty());
}

#[test]
fn test_fact_id_display_for_links() {
    let mut a = fact("A", "body", &[]);
    let b = fact("B", "body", &[]);
    let b_id: FactId = b.id;
    a.links = vec![b_id];
    let graph = AssociationGraph::build(&[a, b]);
    assert_eq!(graph.edge_count(), 1);
}
//! Recall threshold modes, match metrics, and query-length-independent scoring.
//!
//! Provides threshold modes for A/B testing:
//! - `absolute`: raw BM25 >= 12.0 (v0.13 baseline)
//! - `per-term`: raw BM25 / min(|Q|, 8) >= threshold (default 2.75)
//! - `coverage`: fraction of query terms appearing as prefix in fact >= threshold (default 0.5)
//! - `per-term+coverage`: both per-term and coverage must pass

use uma_core::search::SearchHit;
use uma_core::store::Store;

use super::{MIN_ABSOLUTE_SCORE, RELATIVE_SCORE_RATIO};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecallThresholdMode {
    Absolute,
    PerTerm,
    Coverage,
    PerTermAndCoverage,
}

impl RecallThresholdMode {
    pub fn from_str_opt(val: Option<&str>) -> Self {
        match val.map(|s| s.trim().to_lowercase()).as_deref() {
            Some("per-term") | Some("per_term") => Self::PerTerm,
            Some("coverage") => Self::Coverage,
            Some("per-term+coverage") | Some("per_term+coverage") => Self::PerTermAndCoverage,
            _ => Self::Absolute,
        }
    }

    pub fn from_env() -> Self {
        match std::env::var("UMA_RECALL_THRESHOLD_MODE") {
            Ok(ref val) => Self::from_str_opt(Some(val)),
            Err(_) => Self::Absolute,
        }
    }
}

pub fn resolve_per_term_min() -> f64 {
    std::env::var("UMA_RECALL_PER_TERM_MIN")
        .ok()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .unwrap_or(2.75)
}

pub fn resolve_min_coverage() -> f64 {
    std::env::var("UMA_RECALL_MIN_COVERAGE")
        .ok()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .unwrap_or(0.5)
}

/// Extracts unique lowercased terms from the query string.
pub fn query_unique_terms(query: &str) -> Vec<String> {
    let mut terms: Vec<String> = Vec::new();
    for word in query.split(|c: char| !c.is_alphanumeric()) {
        let lower = word.to_lowercase();
        if !lower.is_empty() && !terms.contains(&lower) {
            terms.push(lower);
        }
    }
    terms
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

/// Assembles all searchable text of a fact (title, description, tags, body).
pub fn get_fact_text_for_coverage(hit: &SearchHit) -> String {
    let mut parts = vec![hit.title.clone()];
    if let Some(ref desc) = hit.description {
        parts.push(desc.clone());
    }
    parts.extend(hit.tags.clone());
    parts.push(get_fact_body(hit));
    parts.join(" ")
}

/// Calculates the fraction of query terms appearing (as word prefix) in the fact text.
pub fn compute_coverage(fact_text: &str, query_terms: &[String]) -> f64 {
    if query_terms.is_empty() {
        return 0.0;
    }
    let fact_words: Vec<String> = fact_text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(|w| w.to_lowercase())
        .collect();

    let covered = query_terms
        .iter()
        .filter(|q_term| fact_words.iter().any(|w| w.starts_with(q_term.as_str())))
        .count();

    (covered as f64) / (query_terms.len() as f64)
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MatchMetrics {
    pub query_terms: usize,
    pub per_term: f64,
    pub coverage: f64,
}

/// Computes query match metrics for calibration and threshold evaluation.
pub fn compute_match_metrics(hit: &SearchHit, query_terms: &[String]) -> MatchMetrics {
    let q_len = query_terms.len();
    let eff_q = q_len.min(8).max(1);
    let raw_per_term = if hit.score <= 0.0 || hit.score.is_nan() {
        0.0
    } else {
        hit.score / eff_q as f64
    };
    let per_term = (raw_per_term * 1000.0).round() / 1000.0;

    let fact_text = get_fact_text_for_coverage(hit);
    let raw_coverage = compute_coverage(&fact_text, query_terms);
    let coverage = (raw_coverage * 1000.0).round() / 1000.0;

    MatchMetrics {
        query_terms: q_len,
        per_term,
        coverage,
    }
}

/// Evaluates whether a candidate passes the selected recall threshold mode.
pub fn candidate_passes_threshold(
    score: f64,
    best_score: f64,
    metrics: &MatchMetrics,
    mode: RecallThresholdMode,
    per_term_min: f64,
    min_coverage: f64,
) -> bool {
    if score.is_nan() || score <= 0.0 {
        return false;
    }
    if score < best_score * RELATIVE_SCORE_RATIO {
        return false;
    }
    match mode {
        RecallThresholdMode::Absolute => score >= MIN_ABSOLUTE_SCORE,
        RecallThresholdMode::PerTerm => metrics.per_term >= per_term_min,
        RecallThresholdMode::Coverage => metrics.coverage >= min_coverage,
        RecallThresholdMode::PerTermAndCoverage => {
            metrics.per_term >= per_term_min && metrics.coverage >= min_coverage
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uma_core::domain::{FactId, FactStatus, FactType, Scope};

    fn make_hit(title: &str, body: &str, score: f64) -> SearchHit {
        SearchHit {
            id: FactId::new(),
            title: title.to_string(),
            description: None,
            fact_type: FactType::Decision,
            scope: Scope::Global,
            project_name: "global".to_string(),
            status: FactStatus::Stable,
            supersedes: None,
            score,
            snippet: body.to_string(),
            tags: vec![],
            file_path: None,
        }
    }

    #[test]
    fn test_threshold_mode_parsing() {
        assert_eq!(
            RecallThresholdMode::from_str_opt(None),
            RecallThresholdMode::Absolute
        );
        assert_eq!(
            RecallThresholdMode::from_str_opt(Some("unknown")),
            RecallThresholdMode::Absolute
        );
        assert_eq!(
            RecallThresholdMode::from_str_opt(Some("absolute")),
            RecallThresholdMode::Absolute
        );
        assert_eq!(
            RecallThresholdMode::from_str_opt(Some("per-term")),
            RecallThresholdMode::PerTerm
        );
        assert_eq!(
            RecallThresholdMode::from_str_opt(Some("per_term")),
            RecallThresholdMode::PerTerm
        );
        assert_eq!(
            RecallThresholdMode::from_str_opt(Some("coverage")),
            RecallThresholdMode::Coverage
        );
        assert_eq!(
            RecallThresholdMode::from_str_opt(Some("per-term+coverage")),
            RecallThresholdMode::PerTermAndCoverage
        );
        assert_eq!(
            RecallThresholdMode::from_str_opt(Some("per_term+coverage")),
            RecallThresholdMode::PerTermAndCoverage
        );
    }

    #[test]
    fn test_query_unique_terms() {
        let terms = query_unique_terms("Which Domino version does plugin target Domino?");
        assert_eq!(
            terms,
            vec!["which", "domino", "version", "does", "plugin", "target"]
        );
    }

    #[test]
    fn test_compute_coverage_prefix_matching() {
        let terms = vec!["domino".to_string(), "target".to_string(), "export".to_string()];
        // "domino" matches "domino", "target" matches "targets", "export" matches "exportdxl"
        let text = "IBM Domino server targets the exportdxl line of agents";
        assert_eq!(compute_coverage(text, &terms), 1.0);

        let partial_text = "IBM Domino server";
        assert_eq!(
            (compute_coverage(partial_text, &terms) * 1000.0).round() / 1000.0,
            0.333
        );
    }

    #[test]
    fn test_candidate_passes_threshold_modes() {
        let hit = make_hit("Domino targets", "exporting pipeline", 11.05);
        let q_terms = vec![
            "domino".to_string(),
            "version".to_string(),
            "plugin".to_string(),
            "target".to_string(),
        ];
        let metrics = compute_match_metrics(&hit, &q_terms);
        assert_eq!(metrics.query_terms, 4);
        assert_eq!(metrics.per_term, 2.763); // 11.05 / 4 = 2.7625 -> 2.763
        assert_eq!(metrics.coverage, 0.5); // domino, target match -> 2/4 = 0.5

        // Absolute mode (12.0) fails 11.05
        assert!(!candidate_passes_threshold(
            hit.score,
            11.05,
            &metrics,
            RecallThresholdMode::Absolute,
            2.75,
            0.5
        ));

        // PerTerm mode (2.75) passes 2.763
        assert!(candidate_passes_threshold(
            hit.score,
            11.05,
            &metrics,
            RecallThresholdMode::PerTerm,
            2.75,
            0.5
        ));

        // Coverage mode (0.5) passes 0.5
        assert!(candidate_passes_threshold(
            hit.score,
            11.05,
            &metrics,
            RecallThresholdMode::Coverage,
            2.75,
            0.5
        ));

        // PerTermAndCoverage passes both
        assert!(candidate_passes_threshold(
            hit.score,
            11.05,
            &metrics,
            RecallThresholdMode::PerTermAndCoverage,
            2.75,
            0.5
        ));

        // Relative 50% cutoff still holds even in per-term mode
        assert!(!candidate_passes_threshold(
            hit.score,
            25.0, // 11.05 < 25.0 * 0.5 (12.5)
            &metrics,
            RecallThresholdMode::PerTerm,
            2.75,
            0.5
        ));
    }
}

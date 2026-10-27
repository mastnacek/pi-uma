//! Recall query construction, term limiting, and rarity/IDF term selection.

use uma_core::indexer::Indexer;
use uma_core::store::Store;

const NOISE: &[&str] = &[
    "the", "and", "for", "with", "that", "this", "please", "could", "would", "does", "jak",
    "pro", "nebo", "když", "aby", "tedy",
];

/// Maximum number of terms to include in the recall query
/// (env `UMA_RECALL_MAX_TERMS`, default 12; 0 = no limit).
pub fn resolve_max_terms() -> usize {
    resolve_max_terms_from(std::env::var("UMA_RECALL_MAX_TERMS").ok().as_deref())
}

pub fn resolve_max_terms_from(val: Option<&str>) -> usize {
    val.and_then(|v| v.trim().parse::<usize>().ok()).unwrap_or(12)
}

/// Term selection strategy (env `UMA_RECALL_TERM_PICK`, "head" (default) | "rare").
pub fn resolve_term_pick() -> String {
    resolve_term_pick_from(std::env::var("UMA_RECALL_TERM_PICK").ok().as_deref())
}

pub fn resolve_term_pick_from(val: Option<&str>) -> String {
    match val.map(|v| v.trim().to_lowercase()).as_deref() {
        Some("rare") => "rare".to_string(),
        _ => "head".to_string(),
    }
}

/// Builds the search query from the prompt: meaningful words only, capped, so
/// BM25 keeps signal instead of matching everything vaguely.
pub(crate) fn recall_query(prompt: &str) -> String {
    let max_terms = resolve_max_terms();
    let pick = resolve_term_pick();
    if pick == "rare" {
        if let Ok(indexer) = Store::central_indexer() {
            return recall_query_rare(prompt, &indexer, max_terms);
        }
    }
    recall_query_head(prompt, max_terms)
}

pub(crate) fn recall_query_head(prompt: &str, max_terms: usize) -> String {
    let iter = prompt
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| word.chars().count() > 2 && !NOISE.contains(&word.to_lowercase().as_str()))
        .map(str::to_string);

    if max_terms == 0 {
        iter.collect::<Vec<_>>().join(" ")
    } else {
        iter.take(max_terms).collect::<Vec<_>>().join(" ")
    }
}

pub(crate) fn recall_query_rare(prompt: &str, indexer: &Indexer, max_terms: usize) -> String {
    let words: Vec<String> = prompt
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| word.chars().count() > 2 && !NOISE.contains(&word.to_lowercase().as_str()))
        .map(str::to_string)
        .collect();

    if words.is_empty() {
        return String::new();
    }

    let mut seen = std::collections::HashSet::new();
    let mut scored: Vec<(usize, &String, i64)> = words
        .iter()
        .enumerate()
        .filter_map(|(idx, word)| {
            let clean = word.trim_matches(|c: char| !c.is_alphanumeric() && c != '_');
            if clean.is_empty() {
                return None;
            }
            if !seen.insert(clean.to_lowercase()) {
                return None;
            }
            let count = indexer.term_doc_count(clean);
            if count > 0 {
                Some((idx, word, count))
            } else {
                None // terms not in the index are skipped
            }
        })
        .collect();

    if scored.is_empty() {
        return recall_query_head(prompt, max_terms);
    }

    // Sort by count ascending (lowest count = rarest = highest IDF).
    // Stable sort preserves order for equal counts.
    scored.sort_by_key(|&(_, _, count)| count);

    let cap = if max_terms == 0 {
        scored.len()
    } else {
        max_terms
    };
    let mut selected: Vec<(usize, &String)> = scored
        .into_iter()
        .take(cap)
        .map(|(idx, w, _)| (idx, w))
        .collect();

    // Preserve original prompt order
    selected.sort_by_key(|&(idx, _)| idx);

    selected
        .into_iter()
        .map(|(_, w)| w.as_str())
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use uma_core::domain::{Fact, FactType, Scope};

    #[test]
    fn test_resolve_max_terms() {
        assert_eq!(resolve_max_terms_from(None), 12);
        assert_eq!(resolve_max_terms_from(Some("")), 12);
        assert_eq!(resolve_max_terms_from(Some("invalid")), 12);
        assert_eq!(resolve_max_terms_from(Some("8")), 8);
        assert_eq!(resolve_max_terms_from(Some("0")), 0);
    }

    #[test]
    fn test_resolve_term_pick() {
        assert_eq!(resolve_term_pick_from(None), "head");
        assert_eq!(resolve_term_pick_from(Some("")), "head");
        assert_eq!(resolve_term_pick_from(Some("head")), "head");
        assert_eq!(resolve_term_pick_from(Some("rare")), "rare");
        assert_eq!(resolve_term_pick_from(Some("RARE")), "rare");
        assert_eq!(resolve_term_pick_from(Some("other")), "head");
    }

    #[test]
    fn test_recall_query_head_capping() {
        let long_prompt = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen";
        let capped = recall_query_head(long_prompt, 12);
        assert_eq!(capped.split_whitespace().count(), 12);
        assert_eq!(
            capped,
            "one two three four five six seven eight nine ten eleven twelve"
        );

        let uncapped = recall_query_head(long_prompt, 0);
        assert_eq!(uncapped.split_whitespace().count(), 15);

        let short_cap = recall_query_head(long_prompt, 3);
        assert_eq!(short_cap, "one two three");
    }

    #[test]
    fn test_recall_query_rare_selection() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("index.db");
        let indexer = Indexer::open(&db_path).unwrap();

        // Index facts with different term frequencies:
        // "common" appears in 3 facts
        // "medium" appears in 2 facts
        // "rare" appears in 1 fact
        // "absent" appears in 0 facts
        let f1 = Fact::new(
            Scope::Global,
            FactType::Decision,
            "F1".to_string(),
            "common word here".to_string(),
        );
        let f2 = Fact::new(
            Scope::Global,
            FactType::Decision,
            "F2".to_string(),
            "common and medium word".to_string(),
        );
        let f3 = Fact::new(
            Scope::Global,
            FactType::Decision,
            "F3".to_string(),
            "common medium and rare word".to_string(),
        );

        indexer.index_fact(&f1, None).unwrap();
        indexer.index_fact(&f2, None).unwrap();
        indexer.index_fact(&f3, None).unwrap();

        // Prompt contains "common absent medium rare"
        // "absent" is not in index, so skipped.
        // Frequencies: "common": 3, "medium": 2, "rare": 1.
        let prompt = "common absent medium rare";

        // With max_terms = 2, picks the 2 rarest ("rare" count 1, "medium" count 2),
        // preserving original prompt order: "medium rare".
        let res_2 = recall_query_rare(prompt, &indexer, 2);
        assert_eq!(res_2, "medium rare");

        // With max_terms = 1, picks only the single rarest: "rare".
        let res_1 = recall_query_rare(prompt, &indexer, 1);
        assert_eq!(res_1, "rare");

        // With max_terms = 0 (no limit), picks all indexed terms in prompt order: "common medium rare".
        let res_0 = recall_query_rare(prompt, &indexer, 0);
        assert_eq!(res_0, "common medium rare");
    }
}

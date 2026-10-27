//! Recall query construction and term limiting.

const NOISE: &[&str] = &[
    "the", "and", "for", "with", "that", "this", "please", "could", "would", "does", "jak", "pro",
    "nebo", "když", "aby", "tedy",
];

/// Maximum number of terms to include in the recall query
/// (env `UMA_RECALL_MAX_TERMS`, default 32; 0 = no limit).
pub fn resolve_max_terms() -> usize {
    resolve_max_terms_from(std::env::var("UMA_RECALL_MAX_TERMS").ok().as_deref())
}

pub fn resolve_max_terms_from(val: Option<&str>) -> usize {
    val.and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(32)
}

/// Builds the search query from the prompt: meaningful words only, capped, so
/// BM25 keeps signal instead of matching everything vaguely.
pub(crate) fn recall_query(prompt: &str) -> String {
    let max_terms = resolve_max_terms();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_max_terms() {
        assert_eq!(resolve_max_terms_from(None), 32);
        assert_eq!(resolve_max_terms_from(Some("")), 32);
        assert_eq!(resolve_max_terms_from(Some("invalid")), 32);
        assert_eq!(resolve_max_terms_from(Some("12")), 12);
        assert_eq!(resolve_max_terms_from(Some("8")), 8);
        assert_eq!(resolve_max_terms_from(Some("0")), 0);
    }

    #[test]
    fn test_recall_query_head_capping() {
        let long_prompt = (1..=40)
            .map(|i| format!("word{}", i))
            .collect::<Vec<_>>()
            .join(" ");

        let capped_32 = recall_query_head(&long_prompt, 32);
        assert_eq!(capped_32.split_whitespace().count(), 32);
        assert_eq!(
            capped_32,
            (1..=32)
                .map(|i| format!("word{}", i))
                .collect::<Vec<_>>()
                .join(" ")
        );

        let capped_12 = recall_query_head(&long_prompt, 12);
        assert_eq!(capped_12.split_whitespace().count(), 12);

        let uncapped = recall_query_head(&long_prompt, 0);
        assert_eq!(uncapped.split_whitespace().count(), 40);

        let short_cap = recall_query_head(&long_prompt, 3);
        assert_eq!(short_cap, "word1 word2 word3");
    }
}

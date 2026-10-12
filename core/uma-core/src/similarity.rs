//! Lexical similarity primitives used by the consolidation proposer.
//!
//! Deliberately deterministic and offline: `cargo test` must be able to exercise
//! consolidation without network access or an embedding API key. Embeddings are
//! an enhancement layered on top, never a prerequisite for proposing a merge.

use std::collections::HashSet;

/// Words too common to carry meaning when comparing two facts.
const STOPWORDS: &[&str] = &[
    "the", "and", "for", "that", "this", "with", "from", "are", "was", "were", "has", "have",
    "had", "its", "our", "you", "your", "but", "not", "any", "all", "can", "will", "would",
    "should", "must", "may", "use", "using", "used", "into", "over", "than", "then", "they",
    "them", "these", "those", "one", "two", "how", "why", "what", "when", "where", "which", "who",
    "also", "only", "more", "most", "such", "each", "other", "some", "very",
    // Czech: the import pipeline is Czech-heavy, and without these the
    // flexion-heavy function words dominate token overlap.
    "nebo", "také", "taky", "jak", "když", "aby", "proto", "tento", "tato", "toto", "tuto", "tohle",
    "který", "která", "které", "jen", "pak", "ještě", "však", "právě", "jenže", "až", "už", "tedy",
    "protože",
];

/// Markers that flip a statement's polarity. Matching is done against the raw
/// lowercased text, so multi-word markers ("do not") work without tokenizing.
const NEGATION_MARKERS: &[&str] = &[
    "not ",
    "no ",
    "never",
    "don't",
    "dont",
    "avoid",
    "without",
    "disable",
    "must not",
    "should not",
    "do not",
    "does not",
    "cannot",
    "reject",
    "refuse",
    "instead of",
    "rather than",
    // Czech negation is a prefix on the verb ("nepoužívat"), so no fixed
    // marker list can catch it; has_negation adds a word-level rule below.
    "nikdy",
    "nesmí",
    "nesmi",
    "bez ",
    "zakázané",
    "zakázaný",
    "zakaz",
];

/// Strips a few common English suffixes so "installs" and "installation" collapse
/// onto the same token. Crude on purpose — over-stemming would merge unrelated
/// words and cost more in false proposals than it saves.
fn stem(token: &str) -> String {
    if token.len() > 4 && token.ends_with("ies") {
        return format!("{}y", &token[..token.len() - 3]);
    }
    for suffix in ["ation", "ing", "ed", "es", "s"] {
        if token.len() > 4 && token.ends_with(suffix) {
            return token[..token.len() - suffix.len()].to_string();
        }
    }
    token.to_string()
}

/// Splits text into comparable lowercase tokens, dropping stopwords and noise.
pub fn tokenize(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .map(|raw| raw.to_lowercase())
        .filter(|t| t.len() >= 3 && !STOPWORDS.contains(&t.as_str()))
        .map(|t| stem(&t))
        .collect()
}

/// Jaccard similarity of two token bags: |A ∩ B| / |A ∪ B|.
pub fn jaccard(a: &[String], b: &[String]) -> f64 {
    let sa: HashSet<&String> = a.iter().collect();
    let sb: HashSet<&String> = b.iter().collect();
    if sa.is_empty() || sb.is_empty() {
        return 0.0;
    }
    let intersection = sa.intersection(&sb).count() as f64;
    let union = sa.union(&sb).count() as f64;
    intersection / union
}

/// Common English words starting with "ne" that must never be mistaken for Czech "ne-" negation prefixes.
const ENGLISH_NE_WORDS: &[&str] = &[
    "network",
    "networks",
    "networking",
    "need",
    "needs",
    "needed",
    "needing",
    "nested",
    "nest",
    "nesting",
    "nests",
    "neural",
    "next",
    "new",
    "newer",
    "newest",
    "newly",
    "negative",
    "negatives",
    "neutral",
    "negotiate",
    "negotiates",
    "negotiating",
    "negotiation",
    "neighbor",
    "neighbour",
    "neighbors",
    "neighbours",
    "necessary",
    "necessarily",
    "needle",
    "neon",
    "nerve",
    "nerves",
];

/// True when the text carries an explicit negation marker.
pub fn has_negation(text: &str) -> bool {
    let lower = text.to_lowercase();
    if NEGATION_MARKERS.iter().any(|marker| lower.contains(marker)) {
        return true;
    }
    // Czech "ne-" prefix on verbs ("nepoužívat", "neukládat").
    // Exclude English words starting with "ne" like "network", "needs", "nested".
    lower
        .split(|c: char| !c.is_alphanumeric())
        .any(|word| word.len() >= 5 && word.starts_with("ne") && !ENGLISH_NE_WORDS.contains(&word))
}

/// True when `needle` occurs in `haystack` as a whole token (surrounded by
/// non-alphanumeric characters or the string edges).
///
/// The heuristic classifiers (skeptic, humility, route) previously used
/// `str::contains`, so a marker matched inside an unrelated word: `api` in
/// `capital`, `uma` in `human`, `ffi` in `efficient`. `risk` already matched
/// whole tokens; this helper makes the others agree with it.
///
/// Markers that are not plain identifiers (spaces, punctuation) fall back to a
/// lowercased substring test.
pub fn contains_word(haystack: &str, needle: &str) -> bool {
    let h = haystack.to_lowercase();
    let n = needle.to_lowercase();
    if n.is_empty() {
        return false;
    }
    if !n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return h.contains(&n);
    }
    let bytes = h.as_bytes();
    let mut from = 0;
    while let Some(pos) = h[from..].find(&n) {
        let abs = from + pos;
        let before_ok = abs == 0 || !bytes[abs - 1].is_ascii_alphanumeric();
        let end = abs + n.len();
        let after_ok = end >= bytes.len() || !bytes[end].is_ascii_alphanumeric();
        if before_ok && after_ok {
            return true;
        }
        from = abs + 1;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tokenize_drops_stopwords_and_stems() {
        let tokens = tokenize("Use pnpm for dependency installation");
        assert!(tokens.contains(&"pnpm".to_string()));
        assert!(tokens.contains(&"dependency".to_string()));
        // "installation" and "installs" must collapse onto one token.
        assert!(tokens.contains(&"install".to_string()));
        assert!(!tokens.contains(&"for".to_string()));
    }

    #[test]
    fn test_jaccard_bounds() {
        let a = tokenize("Use pnpm for dependency installs");
        let b = tokenize("Use pnpm for dependency installation");
        assert!((jaccard(&a, &b) - 1.0).abs() < f64::EPSILON);

        let c = tokenize("Postgres connection pooling");
        assert_eq!(jaccard(&a, &c), 0.0);
        assert_eq!(jaccard(&[], &c), 0.0);
    }

    #[test]
    fn test_has_negation() {
        assert!(!has_negation("Use pnpm for dependency installs"));
        assert!(has_negation("Do not use pnpm for dependency installs"));
        assert!(has_negation("Never install dependencies with npm"));
        assert!(has_negation("Avoid global installs"));
        assert!(!has_negation("Configure network routing for proxy"));
        assert!(!has_negation("Service needs persistent storage"));
        assert!(!has_negation("Use nested component routers"));
        assert!(!has_negation("Neural network weights are cached"));
        assert!(!has_negation("Prepare for next release"));
    }

    #[test]
    fn test_czech_negation_is_detected_but_connectors_are_not() {
        // The review's scenario: two Czech rules differing only in negation
        // must read as opposites, not as near-duplicates.
        assert!(has_negation("Nikdy nepoužívat npm v tomto repozitáři"));
        assert!(has_negation("Nepoužívat npm"));
        assert!(!has_negation("Vždy používat pnpm"));
        // "nebo" (or) starts with "ne" but is a connector, not a negation.
        assert!(!has_negation("Používat pnpm nebo npm"));
    }

    #[test]
    fn test_czech_stopwords_do_not_dominate_overlap() {
        // Flexion-heavy function words must not inflate similarity between
        // unrelated Czech claims.
        let a = tokenize("Vždy používat pnpm v tomto repozitáři pro instalace");
        let b = tokenize("Nikdy neupravovat vygenerované soubory v tomto repozitáři");
        assert!(
            jaccard(&a, &b) < 0.55,
            "unrelated Czech rules must not merge"
        );
    }

    #[test]
    fn test_contains_word_rejects_substring_false_positives() {
        // The exact false positives the review named.
        assert!(!contains_word("ask a human about it", "uma"));
        assert!(!contains_word("make it more efficient", "ffi"));
        assert!(!contains_word("capital gains", "api"));
        assert!(!contains_word("the model router", "mod"));
        assert!(!contains_word("block the thread", "lock"));
        assert!(!contains_word("restore the backup", "store"));
    }

    #[test]
    fn test_contains_word_accepts_whole_tokens() {
        assert!(contains_word("route this to uma please", "uma"));
        assert!(contains_word("touch the FFI layer", "ffi"));
        assert!(contains_word("change the public api schema", "api"));
        assert!(contains_word("sqlite locking rewrite", "locking"));
        assert!(contains_word("run the migration", "migration"));
        // Non-identifier markers fall back to a substring test.
        assert!(contains_word("use macro_rules here", "macro_rules"));
    }
}

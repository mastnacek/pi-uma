/// Builds the search query from the prompt: meaningful words only, capped, so
/// BM25 keeps signal instead of matching everything vaguely.
pub(crate) fn recall_query(prompt: &str) -> String {
    const NOISE: &[&str] = &[
        // English functional / grammatical / pronouns
        "the", "and", "for", "with", "that", "this", "these", "those", "please", "could", "would",
        "should", "does", "did", "have", "has", "had", "can", "will", "are", "were", "been",
        "being", "what", "which", "where", "when", "why", "who", "whom", "how", "from", "into",
        "onto", "over", "under", "about", "above", "after", "before", "than", "then", "just",
        "very", "also", "more", "most", "some", "any", "each", "all", "both", "only", "other",
        "such", "you", "your", "yours", "they", "them", "their", "theirs", "him", "his", "her",
        "hers", "its", "our", "ours", // English conversational fillers
        "want", "like", "need", "know", "think", "tell", "show", "help", "give", "make", "take",
        "using", "used", "work", "working", "look", "looking", "much", "many", "here", "there",
        // Czech functional / grammatical
        "jak", "pro", "nebo", "když", "aby", "tedy", "tak", "jako", "jsou", "bude", "byl", "byla",
        "bylo", "byli", "tento", "tato", "toto", "tyto", "který", "která", "které", "kterou",
        "kterým", "kteří", "jeho", "její", "jejich", "jsem", "jsme", "jste", "chci", "může",
        "můžeš", "musí", "máme", "mají", "proto", "také", "jen", "jenom", "vše", "všechny", "více",
        "ještě", "před", "přes", "mezi", "podle",
    ];

    let words: Vec<&str> = prompt
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| word.chars().count() > 2 && !NOISE.contains(&word.to_lowercase().as_str()))
        .collect();

    let mode = std::env::var("UMA_RECALL_QUERY").unwrap_or_else(|_| "salient".to_string());
    if mode == "first" {
        return words
            .into_iter()
            .take(12)
            .map(str::to_string)
            .collect::<Vec<_>>()
            .join(" ");
    }

    if words.is_empty() {
        return String::new();
    }

    // Salient selection: find up to 12 most informative terms from the entire prompt.
    // Group unique terms (case-insensitive) while tracking original position, casing, and occurrences.
    struct WordStat<'a> {
        original: &'a str,
        first_idx: usize,
        count: usize,
    }

    let mut map: std::collections::HashMap<String, WordStat> = std::collections::HashMap::new();
    for (idx, &word) in words.iter().enumerate() {
        let key = word.to_lowercase();
        map.entry(key)
            .and_modify(|e| e.count += 1)
            .or_insert(WordStat {
                original: word,
                first_idx: idx,
                count: 1,
            });
    }

    let total_words = words.len().max(1) as f64;
    let mut scored: Vec<(f64, WordStat)> = map
        .into_values()
        .map(|stat| {
            let len = stat.original.chars().count() as f64;
            // Identifiers / acronyms: CamelCase, all caps, or digits
            let has_upper_inside = stat.original.chars().skip(1).any(|c| c.is_uppercase());
            let is_all_caps = stat.original.len() >= 3
                && stat
                    .original
                    .chars()
                    .all(|c| c.is_uppercase() || !c.is_alphabetic());
            let has_digits = stat.original.chars().any(|c| c.is_numeric());
            let id_bonus = if has_upper_inside || is_all_caps || has_digits {
                4.0
            } else {
                0.0
            };

            // Position bonus: in human prompts, core questions/entities tend to appear towards the end
            let pos_ratio = stat.first_idx as f64 / total_words;
            let pos_bonus = pos_ratio * 3.0;

            // Frequency bonus: repeated words reflect intentional focus
            let freq_bonus = (stat.count.saturating_sub(1)) as f64 * 2.0;

            let score = len + id_bonus + pos_bonus + freq_bonus;
            (score, stat)
        })
        .collect();

    // Sort by salience score descending
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    // Retain top 12
    let mut top_words: Vec<WordStat> = scored.into_iter().take(12).map(|(_, s)| s).collect();

    // Re-sort by appearance order in prompt to preserve phrase and proximity structure
    top_words.sort_by_key(|s| s.first_idx);

    top_words
        .into_iter()
        .map(|s| s.original.to_string())
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_noise_filtering_expanded() {
        let prompt = "Please could you help me think about using this new feature";
        let query = recall_query(prompt);
        // "please", "could", "help", "think", "about", "using", "this" are noise
        assert_eq!(query, "new feature");
    }

    #[test]
    fn test_salient_mode_picks_informative_terms_from_tail() {
        // Construct a prompt where the first 15 words are low-information 3-4 letter words,
        // and the crucial domain terms are at the end.
        let prompt = "one two red blue cat dog sun sky sea day cup box pen fan \
                      ExportDXL pipeline synchronization architecture";

        // Salient mode (default)
        let query = recall_query(prompt);
        assert!(query.contains("ExportDXL"), "query must contain ExportDXL");
        assert!(
            query.contains("synchronization"),
            "query must contain synchronization"
        );
        assert!(
            query.contains("architecture"),
            "query must contain architecture"
        );
        assert!(query.contains("pipeline"), "query must contain pipeline");
    }

    #[test]
    fn test_salient_preserves_prompt_word_order() {
        let prompt = "We need complex authentication synchronization in ExportDXL agents";
        let query = recall_query(prompt);
        let pos_auth = query.find("authentication").unwrap();
        let pos_sync = query.find("synchronization").unwrap();
        let pos_dxl = query.find("ExportDXL").unwrap();
        let pos_agents = query.find("agents").unwrap();

        assert!(pos_auth < pos_sync);
        assert!(pos_sync < pos_dxl);
        assert!(pos_dxl < pos_agents);
    }
}

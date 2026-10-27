//! FTS5 query construction and scope parsing.

use crate::domain::Scope;

/// Builds a prefix-match FTS5 query from free-form user input.
/// Replaces '-' inside terms with space so FTS5 does not interpret it as NOT.
pub fn build_fts_query(query: &str) -> String {
    let normalized = query.replace('-', " ");
    let tokens: Vec<&str> = normalized.split_whitespace().collect();
    if tokens.is_empty() {
        return query.to_string();
    }
    tokens
        .iter()
        .map(|t| {
            let clean = t.trim_matches(|c: char| !c.is_alphanumeric() && c != '_');
            if clean.is_empty() {
                format!("\"{}\"", t)
            } else {
                format!("{}*", clean)
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Builds an any-term (OR) FTS5 query: the relaxation for multi-token
/// queries where the implicit-AND form matched nothing.
/// Replaces '-' inside terms with space so FTS5 does not interpret it as NOT.
pub fn build_fts_query_or(query: &str) -> String {
    let normalized = query.replace('-', " ");
    let tokens: Vec<&str> = normalized.split_whitespace().collect();
    if tokens.is_empty() {
        return query.to_string();
    }
    tokens
        .iter()
        .map(|t| {
            let clean = t.trim_matches(|c: char| !c.is_alphanumeric() && c != '_');
            if clean.is_empty() {
                format!("\"{}\"", t)
            } else {
                format!("{}*", clean)
            }
        })
        .collect::<Vec<_>>()
        .join(" OR ")
}

/// Builds a quoted FTS5 query safe against syntax errors from special characters.
pub fn build_safe_fts_query(query: &str) -> String {
    query
        .replace('-', " ")
        .split_whitespace()
        .map(|t| format!("\"{}\"", t.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn parse_scope_str(s: &str) -> Scope {
    if s == "global" {
        Scope::Global
    } else if let Some(name) = s.strip_prefix("project:") {
        Scope::Project(name.to_string())
    } else {
        Scope::Project(s.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hyphen_replacement_prevents_fts5_not() {
        assert_eq!(build_fts_query("fail-closed"), "fail* closed*");
        assert_eq!(build_fts_query_or("fail-closed"), "fail* OR closed*");
        assert_eq!(build_safe_fts_query("fail-closed"), "\"fail\" \"closed\"");
    }

    #[test]
    fn test_unhyphenated_queries_unchanged() {
        assert_eq!(build_fts_query("hello world"), "hello* world*");
        assert_eq!(build_fts_query_or("hello world"), "hello* OR world*");
        assert_eq!(build_safe_fts_query("hello world"), "\"hello\" \"world\"");
    }
}

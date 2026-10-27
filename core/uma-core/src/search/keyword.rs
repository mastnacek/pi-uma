//! BM25 keyword search over the FTS5 index.
//!
//! The query is tried as a strict FTS5 expression first and retried with a
//! sanitized form when that fails, so a query containing FTS operators (or a
//! stray quote) degrades to something searchable instead of erroring.

use super::{SearchHit, SearchOptions};
use crate::domain::{FactId, FactStatus, FactType, Scope};
use crate::indexer::{build_fts_query, build_fts_query_or, build_safe_fts_query, parse_scope_str};
use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::Connection;
use std::path::PathBuf;
use std::str::FromStr;

/// Performs BM25-ranked keyword search across all indexed facts using FTS5.
///
/// FTS5 joins tokens with an implicit AND, so a multi-token query only hits
/// when one fact contains every term. The any-term relaxation for the
/// recall path lives in [`search_keyword_or`].
pub fn search_keyword(conn: &Connection, opts: &SearchOptions) -> Result<Vec<SearchHit>> {
    let trimmed_query = opts.query.trim();
    if trimmed_query.is_empty() {
        return Ok(Vec::new());
    }
    run_with_fallback(conn, opts, &build_fts_query(trimmed_query))
}

/// Keyword search relaxed to any-term (OR) matching.
///
/// The strict form starves exactly the recall gate's queries: six words
/// demanding all six prefixes in a single fact returned nothing even when
/// the top-ranked fact was the very bug being asked about. Callers must
/// surface that the relaxation happened — a relaxed result is not the same
/// ranking the caller asked for.
pub fn search_keyword_or(conn: &Connection, opts: &SearchOptions) -> Result<Vec<SearchHit>> {
    let trimmed_query = opts.query.trim();
    if trimmed_query.is_empty() {
        return Ok(Vec::new());
    }
    run_with_fallback(conn, opts, &build_fts_query_or(trimmed_query))
}

/// Runs the SELECT with the given FTS expression, falling back to the
/// sanitized (fully quoted) form when the expression itself fails to parse.
fn run_with_fallback(
    conn: &Connection,
    opts: &SearchOptions,
    fts_query: &str,
) -> Result<Vec<SearchHit>> {
    let trimmed_query = opts.query.trim();
    match run_search(conn, opts, fts_query) {
        Ok(res) => Ok(res),
        Err(_) => run_search(conn, opts, &build_safe_fts_query(trimmed_query)),
    }
}

fn run_search(conn: &Connection, opts: &SearchOptions, fts_query: &str) -> Result<Vec<SearchHit>> {
    let mut sql = String::from(
        "SELECT id, scope, project_name, fact_type, title, description,
                snippet(facts_fts, 6, '[match]', '[/match]', '...', 16) AS snippet,
                tags, status, supersedes, file_path, since, until, stale_after,
                bm25(facts_fts, 0.0, 1.0, 1.0, 1.0, 10.0, 5.0, 2.0, 5.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0) AS rank
         FROM facts_fts WHERE facts_fts MATCH ?1",
    );

    if !opts.include_deprecated && opts.as_of.is_none() {
        sql.push_str(" AND (status = 'stable' OR status IS NULL)");
    }

    match opts.scope {
        Some(Scope::Global) => sql.push_str(" AND scope = 'global'"),
        Some(Scope::Project(_)) => sql.push_str(" AND project_name = ?"),
        None => {
            if let Some(_cp) = opts.current_project {
                if opts.project_domains.is_empty() {
                    sql.push_str(
                        " AND (project_name = ? OR (scope = 'global' AND (domains = '' OR domains IS NULL)))",
                    );
                } else {
                    let domain_clauses = opts
                        .project_domains
                        .iter()
                        .map(|_| "instr(' ' || lower(coalesce(domains, '')) || ' ', ?) > 0")
                        .collect::<Vec<_>>()
                        .join(" OR ");
                    sql.push_str(&format!(
                        " AND (project_name = ? OR (scope = 'global' AND (domains = '' OR domains IS NULL OR {domain_clauses})))"
                    ));
                }
            } else {
                // SPAI-046: cwd outside any git repo — degrade to GLOBAL-ONLY without domains.
                // The old branch dropped the filter here, making every
                // project's facts recallable (cross-session leak, observed in
                // OpenMes). No repo means no project to scope to, so only the
                // global store is searched, and domain-tagged facts stay hidden.
                sql.push_str(" AND (scope = 'global' AND (domains = '' OR domains IS NULL))");
            }
        }
    }

    // Anti-echo exclusion: dropped from the competition before the limit,
    // so the caller's `limit` fills entirely with eligible facts.
    let mut excluded_params: Vec<&str> = Vec::new();
    if !opts.exclude_ids.is_empty() {
        let placeholders = opts
            .exclude_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(", ");
        sql.push_str(&format!(" AND id NOT IN ({placeholders})"));
        excluded_params.extend(opts.exclude_ids.iter().map(|s| s.as_str()));
    }

    if opts.fact_type.is_some() {
        sql.push_str(" AND fact_type = ?");
    }

    sql.push_str(" ORDER BY rank ASC LIMIT ?");

    let mut params_vec: Vec<String> = vec![fts_query.to_string()];
    match opts.scope {
        Some(Scope::Project(proj)) => params_vec.push(proj.clone()),
        None => {
            if let Some(cp) = opts.current_project {
                params_vec.push(cp.to_string());
                for d in &opts.project_domains {
                    params_vec.push(format!(" {} ", d.trim().to_lowercase()));
                }
            }
        }
        _ => {}
    }
    // Placeholder order must mirror the SQL: scope, exclusions, fact_type.
    for excluded in excluded_params {
        params_vec.push(excluded.to_string());
    }
    if let Some(ft) = opts.fact_type {
        params_vec.push(ft.to_string());
    }

    let sql_limit = if opts.as_of.is_some() {
        opts.limit.max(50) * 10
    } else {
        opts.limit
    };

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(
        params_vec
            .iter()
            .map(|s| s as &dyn rusqlite::ToSql)
            .chain(std::iter::once(&sql_limit as &dyn rusqlite::ToSql)),
    ))?;

    let mut hits = Vec::new();
    while let Some(row) = rows.next()? {
        let id_str: String = row.get(0)?;
        let scope_str: String = row.get(1)?;
        let project_name: String = row.get(2)?;
        let type_str: String = row.get(3)?;
        let title: String = row.get(4)?;
        let description: Option<String> = row.get(5)?;
        let snippet: String = row.get(6)?;
        let tags_str: String = row.get(7)?;
        let status_str: String = row.get(8).unwrap_or_else(|_| "stable".to_string());
        let supersedes_str: Option<String> = row.get(9).ok();
        let file_path_str: String = row.get(10)?;
        let since_str: String = row.get(11).unwrap_or_default();
        let until_str: Option<String> = row.get(12).ok();
        let stale_str: Option<String> = row.get(13).ok();
        let rank: f64 = row.get(14)?;

        let status = FactStatus::from_str(&status_str).unwrap_or(FactStatus::Stable);

        let now = Utc::now();
        if opts.as_of.is_none() {
            if let Ok(since_dt) = DateTime::parse_from_rfc3339(&since_str) {
                if since_dt.with_timezone(&Utc) > now {
                    continue;
                }
            }
        }

        if let Some(target_dt) = opts.as_of {
            if let Ok(since_dt) = DateTime::parse_from_rfc3339(&since_str) {
                if since_dt.with_timezone(&Utc) > target_dt {
                    continue;
                }
            }
            if let Some(ref u_str) = until_str {
                if let Ok(until_dt) = DateTime::parse_from_rfc3339(u_str) {
                    if target_dt >= until_dt.with_timezone(&Utc) {
                        continue;
                    }
                }
            }
            if let Some(ref s_str) = stale_str {
                if let Ok(stale_dt) = DateTime::parse_from_rfc3339(s_str) {
                    if target_dt >= stale_dt.with_timezone(&Utc) {
                        continue;
                    }
                }
            }
        }

        let file_path = if file_path_str.is_empty() {
            None
        } else {
            Some(PathBuf::from(file_path_str))
        };
        let supersedes = supersedes_str.and_then(|s| FactId::from_str(&s).ok());

        hits.push(SearchHit {
            id: FactId::from_str(&id_str)?,
            scope: parse_scope_str(&scope_str),
            project_name,
            fact_type: FactType::from_str(&type_str).unwrap_or(FactType::Note),
            title,
            description,
            snippet,
            tags: tags_str.split_whitespace().map(String::from).collect(),
            status,
            supersedes,
            file_path,
            score: -rank,
        });

        if hits.len() >= opts.limit {
            break;
        }
    }
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Fact, FactType, Scope};
    use crate::indexer::Indexer;
    use tempfile::tempdir;

    #[test]
    fn test_domain_filtering_scenarios() -> Result<()> {
        let dir = tempdir()?;
        let indexer = Indexer::open(dir.path().join("index.db"))?;

        let mut universal = Fact::new(
            Scope::Global,
            FactType::Decision,
            "Universal Fact".to_string(),
            "Applies everywhere without domain restriction.".to_string(),
        );
        universal.domains = Vec::new();

        let mut domino_fact = Fact::new(
            Scope::Global,
            FactType::Decision,
            "Lotus Domino Rule".to_string(),
            "Specific to Domino runtime environment.".to_string(),
        );
        domino_fact.domains = vec!["domino".to_string()];

        let proj_fact = Fact::new(
            Scope::Project("my-proj".to_string()),
            FactType::Decision,
            "My Proj Internal".to_string(),
            "Project private memory.".to_string(),
        );

        indexer.index_fact(&universal, None)?;
        indexer.index_fact(&domino_fact, None)?;
        indexer.index_fact(&proj_fact, None)?;

        // 1. Outside git repo (no current_project, no scope):
        // Only global facts WITHOUT domains are returned.
        let opts_outside = SearchOptions {
            query: "environment restriction",
            scope: None,
            current_project: None,
            project_domains: Vec::new(),
            fact_type: None,
            include_deprecated: false,
            as_of: None,
            exclude_ids: Vec::new(),
            limit: 10,
        };
        let hits = search_keyword_or(indexer.connection(), &opts_outside)?;
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, universal.id);

        // 2. Inside project WITHOUT domains (e.g. standard project):
        // Domino fact is hidden, universal and own project facts appear.
        let opts_no_domain = SearchOptions {
            query: "Domino restriction",
            scope: None,
            current_project: Some("my-proj"),
            project_domains: Vec::new(),
            fact_type: None,
            include_deprecated: false,
            as_of: None,
            exclude_ids: Vec::new(),
            limit: 10,
        };
        let hits = search_keyword_or(indexer.connection(), &opts_no_domain)?;
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, universal.id);

        // 3. Inside project WITH domain "domino":
        // Domino fact appears along with universal fact!
        let opts_with_domain = SearchOptions {
            query: "Domino restriction",
            scope: None,
            current_project: Some("my-proj"),
            project_domains: vec!["domino".to_string()],
            fact_type: None,
            include_deprecated: false,
            as_of: None,
            exclude_ids: Vec::new(),
            limit: 10,
        };
        let hits = search_keyword_or(indexer.connection(), &opts_with_domain)?;
        assert_eq!(hits.len(), 2);
        let ids: Vec<_> = hits.iter().map(|h| h.id).collect();
        assert!(ids.contains(&universal.id));
        assert!(ids.contains(&domino_fact.id));

        // 4. Inside project WITH different domain "web":
        // Domino fact is still hidden.
        let opts_other_domain = SearchOptions {
            query: "Domino restriction",
            scope: None,
            current_project: Some("my-proj"),
            project_domains: vec!["web".to_string()],
            fact_type: None,
            include_deprecated: false,
            as_of: None,
            exclude_ids: Vec::new(),
            limit: 10,
        };
        let hits = search_keyword_or(indexer.connection(), &opts_other_domain)?;
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, universal.id);

        // 5. Explicit scope Global:
        // Returns both universal and domain-tagged global facts.
        let opts_explicit_global = SearchOptions {
            query: "Domino restriction",
            scope: Some(&Scope::Global),
            current_project: None,
            project_domains: Vec::new(),
            fact_type: None,
            include_deprecated: false,
            as_of: None,
            exclude_ids: Vec::new(),
            limit: 10,
        };
        let hits = search_keyword_or(indexer.connection(), &opts_explicit_global)?;
        assert_eq!(hits.len(), 2);
        let ids: Vec<_> = hits.iter().map(|h| h.id).collect();
        assert!(ids.contains(&universal.id));
        assert!(ids.contains(&domino_fact.id));

        Ok(())
    }
}

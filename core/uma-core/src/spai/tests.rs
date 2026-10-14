use super::*;
use std::fs;

fn backlog(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("uma_spai_{tag}_{}_{nanos}", std::process::id()));
    fs::create_dir_all(&dir).expect("tempdir");
    dir
}

fn write_item(dir: &Path, file: &str, status: &str, title: &str, body: &str) {
    fs::write(
        dir.join(file),
        format!("---\ntype: Todo\ntitle: \"{title}\"\nstatus: {status}\n---\n\n{body}\n"),
    )
    .expect("write item");
}

#[test]
fn references_parse_bare_and_qualified() {
    let bare = parse_reference("SPAI-012").expect("bare reference");
    assert_eq!(bare.project, None);
    assert_eq!(bare.id, "SPAI-012");

    let qualified = parse_reference("pi-herdr-sidebar/SPAI-012").expect("qualified");
    assert_eq!(qualified.project.as_deref(), Some("pi-herdr-sidebar"));
    assert_eq!(qualified.id, "SPAI-012");

    // The qualifier comes from the last `/`, so a Windows path keeps its shape.
    let path = parse_reference("D:/x/pi-herdr-sidebar/SPAI-12").expect("path-qualified");
    assert_eq!(path.project.as_deref(), Some("D:/x/pi-herdr-sidebar"));
    assert_eq!(path.id, "SPAI-012", "canonicalized");

    assert!(parse_reference("").is_none());
    assert!(parse_reference("   ").is_none());
    assert!(parse_reference("no id here").is_none());
    assert!(parse_reference("pi-herdr-sidebar/").is_none(), "qualifier without an id");
}

#[test]
fn scan_ids_canonicalizes_and_dedups() {
    assert_eq!(
        scan_ids("SPAI-035 spai-35 SPAI-7 SPAI- XSPAI-9"),
        vec!["SPAI-035", "SPAI-007", "SPAI-009"]
    );
}

#[test]
fn status_weight_decays_finished_work() {
    assert!(status_weight("todo") > status_weight("idea"));
    assert!(status_weight("idea") > status_weight("done"));
    assert!(status_weight("done") > status_weight("cancelled"));
    assert_eq!(status_weight("mystery"), 0.7, "unknown is never 'open'");
}

#[test]
fn search_ranks_open_above_done_and_drops_cancelled() {
    let dir = backlog("rank");
    write_item(
        &dir,
        "2026-01-01-SPAI-001-open.md",
        "todo",
        "Contract check",
        "tier work",
    );
    write_item(
        &dir,
        "2026-01-01-SPAI-002-done.md",
        "done",
        "Contract check done",
        "tier work",
    );
    write_item(
        &dir,
        "2026-01-01-SPAI-003-cancel.md",
        "cancelled",
        "Contract check cancelled",
        "tier work",
    );

    let hits = search_backlog(&dir, "tier", 10);
    assert_eq!(hits.len(), 3);
    assert_eq!(hits[0].id, "SPAI-001", "open work ranks first");
    assert_eq!(hits[1].id, "SPAI-002");
    assert_eq!(hits[2].id, "SPAI-003", "cancelled decays last");
    assert!(hits[0].score > hits[2].score * 3.0);

    fs::remove_dir_all(dir).ok();
}

#[test]
fn title_matches_outrank_body_only_matches() {
    let dir = backlog("title");
    write_item(
        &dir,
        "2026-01-01-SPAI-010-a.md",
        "todo",
        "unrelated",
        "mentions the term once",
    );
    write_item(
        &dir,
        "2026-01-01-SPAI-011-b.md",
        "todo",
        "term in the title",
        "nothing else",
    );
    let hits = search_backlog(&dir, "term", 10);
    assert_eq!(hits[0].id, "SPAI-011");
    assert!(
        hits[0].score > hits[1].score,
        "title weight is 3x body weight"
    );

    fs::remove_dir_all(dir).ok();
}

#[test]
fn czech_diacritics_snippet_does_not_panic() {
    let dir = backlog("utf8");
    write_item(
        &dir,
        "2026-01-01-SPAI-020-cz.md",
        "todo",
        "Příliš žluťoučký kůň",
        "Tělo poznámky s ďábelskými ódami a příliš dlouhým českým textem, který musí bezpečně oříznout žluťoučký kůň úpěl ďábelské ódy zvláště.",
    );
    let hits = search_backlog(&dir, "žluťoučký", 10);
    assert_eq!(hits.len(), 1);
    assert!(hits[0].snippet.contains("žluťoučký"));

    fs::remove_dir_all(dir).ok();
}

#[test]
fn missing_dir_malformed_and_unrelated_files_are_clean_misses() {
    assert!(search_backlog(Path::new("D:/definitely/not/here"), "xx", 5).is_empty());

    let dir = backlog("miss");
    fs::write(
        dir.join("2026-01-01-SPAI-030-broken.md"),
        "no frontmatter at all",
    )
    .ok();
    fs::write(dir.join("not-markdown.txt"), "term").ok();
    fs::write(dir.join(".hidden.md"), "term").ok();
    assert!(search_backlog(&dir, "term", 5).is_empty());
    assert!(
        search_backlog(&dir, "", 5).is_empty(),
        "empty query matches nothing"
    );

    fs::remove_dir_all(dir).ok();
}

#[test]
fn find_item_and_meta_roundtrip() {
    let dir = backlog("find");
    write_item(&dir, "2026-01-01-SPAI-035-x.md", "done", "Tier 1a", "body");
    let path = find_item(&dir, 35).expect("found");
    let (meta, body) = read_item_meta(&path).expect("meta");
    assert_eq!(meta.status.as_deref(), Some("done"));
    assert_eq!(meta.title.as_deref(), Some("Tier 1a"));
    assert!(body.contains("body"));
    assert!(find_item(&dir, 36).is_none());

    fs::remove_dir_all(dir).ok();
}

#[test]
fn limit_is_respected() {
    let dir = backlog("limit");
    for n in 1..=5 {
        write_item(
            &dir,
            &format!("2026-01-01-SPAI-{n:03}-x.md"),
            "todo",
            "shared term",
            "shared term",
        );
    }
    assert_eq!(search_backlog(&dir, "shared", 2).len(), 2);
    fs::remove_dir_all(dir).ok();
}

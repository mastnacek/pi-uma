//! User-facing timestamp parsing for the CLI.
//!
//! A user typing a deadline should not have to spell out RFC 3339; a bare date
//! is the common case and is understood as end of day UTC.

use anyhow::{bail, Result};
use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};

/// Parses an RFC 3339 timestamp (`2026-12-31T23:59:59Z`), or a bare date
/// (`2026-12-31`) understood as 23:59:59 UTC on that day.
///
/// An explicit failure is better than a silent default: writing a fact with the
/// wrong expiry because the format was silently guessed is worse than refusing
/// to write it.
pub fn parse_datetime_or_date(input: &str) -> Result<DateTime<Utc>> {
    let trimmed = input.trim();

    if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
        return Ok(dt.with_timezone(&Utc));
    }

    if let Ok(date) = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
        let Some(end_of_day) = date.and_hms_opt(23, 59, 59) else {
            bail!("invalid date '{trimmed}'");
        };
        return Ok(Utc.from_utc_datetime(&end_of_day));
    }

    Err(anyhow::anyhow!(
        "Invalid timestamp '{trimmed}'. Use RFC 3339 (2026-12-31T23:59:59Z) or a date (2026-12-31)."
    ))
}

/// Parses an `--as-of` value: RFC 3339, a bare date, or a relative `+Nd`
/// (`+30d` = thirty days from now) for time-travel simulation of decay.
///
/// The relative form exists because the common case is *"what does memory
/// look like a month from now if nothing gets reinforced?"* — asking the
/// user to compute that timestamp by hand defeats the simulation.
pub fn parse_as_of(input: &str) -> Result<DateTime<Utc>> {
    let trimmed = input.trim();

    if let Some(inner) = trimmed.strip_prefix('+') {
        let Some(days) = inner.strip_suffix('d') else {
            bail!("Invalid relative time '{trimmed}'. Use +Nd, e.g. +30d for thirty days from now.");
        };
        let days: i64 = days
            .parse()
            .map_err(|_| anyhow::anyhow!("Invalid relative time '{trimmed}'. Use +Nd, e.g. +30d."))?;
        return Ok(Utc::now() + Duration::days(days));
    }

    parse_datetime_or_date(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rfc3339_is_parsed_exactly() {
        let dt = parse_datetime_or_date("2026-12-31T12:00:00Z").unwrap();
        assert_eq!(dt.to_rfc3339(), "2026-12-31T12:00:00+00:00");
    }

    #[test]
    fn test_bare_date_means_end_of_day_utc() {
        let dt = parse_datetime_or_date("2026-12-31").unwrap();
        assert_eq!(dt.to_rfc3339(), "2026-12-31T23:59:59+00:00");
    }

    #[test]
    fn test_offsets_are_normalised_to_utc() {
        let dt = parse_datetime_or_date("2026-12-31T14:00:00+02:00").unwrap();
        assert_eq!(dt.to_rfc3339(), "2026-12-31T12:00:00+00:00");
    }

    #[test]
    fn test_garbage_is_rejected_loudly() {
        let err = parse_datetime_or_date("next tuesday").unwrap_err();
        assert!(err.to_string().contains("Invalid timestamp"));
    }

    #[test]
    fn test_as_of_relative_days_land_in_the_future() {
        let before = Utc::now();
        let dt = parse_as_of("+30d").unwrap();
        let after = Utc::now();
        assert!(dt >= before + Duration::days(30));
        assert!(dt <= after + Duration::days(30));
    }

    #[test]
    fn test_as_of_absolute_forms_still_work() {
        assert!(parse_as_of("2026-12-31").is_ok());
        assert!(parse_as_of("2026-12-31T12:00:00Z").is_ok());
    }

    #[test]
    fn test_as_of_rejects_unitless_and_garbage_relative() {
        assert!(parse_as_of("+30").is_err(), "missing the d suffix");
        assert!(parse_as_of("+xd").is_err());
    }
}

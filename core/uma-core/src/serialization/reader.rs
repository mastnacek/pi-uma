use chrono::{DateTime, Utc};
use std::str::FromStr;
use yaml_rust2::Yaml;

use crate::domain::{Contract, ContractRule, ContractSeverity, Plasticity, Saliency};

pub fn parse_contract(yaml: &Yaml) -> Option<Contract> {
    if yaml["contract"].is_badvalue() || yaml["contract"].as_hash().is_none() {
        return None;
    }
    let engine = yaml["contract"]["engine"].as_str().unwrap_or("ast-grep").to_string();
    let severity_str = yaml["contract"]["severity"].as_str().unwrap_or("deny");
    let severity = ContractSeverity::from_str(severity_str).unwrap_or(ContractSeverity::Deny);
    let rule_node = &yaml["contract"]["rule"];

    rule_node["pattern"].as_str().map(|pattern| {
        let inside = rule_node["inside"].as_str().map(String::from);
        let message = rule_node["message"].as_str().unwrap_or("").to_string();
        let language = rule_node["language"].as_str().map(String::from);
        Contract {
            engine,
            severity,
            rule: ContractRule {
                pattern: pattern.to_string(),
                inside,
                message,
                language,
            },
        }
    })
}

pub fn parse_plasticity(yaml: &Yaml) -> Option<Plasticity> {
    if yaml["plasticity"].is_badvalue() || yaml["plasticity"].as_hash().is_none() {
        return None;
    }
    let p_node = &yaml["plasticity"];
    let weight = p_node["weight"]
        .as_f64()
        .or_else(|| p_node["weight"].as_str().and_then(|s| s.parse::<f64>().ok()))
        .unwrap_or(0.5);
    let reinforcements = p_node["reinforcements"].as_i64().unwrap_or(0) as u32;
    let frustrations = p_node["frustrations"].as_i64().unwrap_or(0) as u32;
    let last_activated = p_node["last_activated"]
        .as_str()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc));
    let half_life_days = p_node["half_life_days"].as_i64().unwrap_or(90) as u32;

    Some(Plasticity {
        weight,
        reinforcements,
        frustrations,
        last_activated,
        half_life_days,
    })
}

pub fn parse_saliency(yaml: &Yaml) -> Option<Saliency> {
    if yaml["saliency"].is_badvalue() || yaml["saliency"].as_hash().is_none() {
        return None;
    }
    let s_node = &yaml["saliency"];
    let shock_level = s_node["shock_level"].as_i64().unwrap_or(1) as u8;
    let multiplier = s_node["multiplier"]
        .as_f64()
        .or_else(|| s_node["multiplier"].as_str().and_then(|s| s.parse::<f64>().ok()))
        .unwrap_or(1.0);
    let immune_to_decay = s_node["immune_to_decay"].as_bool().unwrap_or(false);

    Some(Saliency {
        shock_level,
        multiplier,
        immune_to_decay,
    })
}

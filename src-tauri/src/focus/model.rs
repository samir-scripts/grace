use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppTarget {
    pub id: String,
    pub name: String,
    pub identifier: String, // bundle_id (macOS) or executable name/path (Windows)
    pub platform: String,   // "macos" | "windows" | "all"
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FocusProfile {
    pub id: String,
    pub name: String,
    pub work_secs: u32,
    pub short_break_secs: u32,
    pub long_break_secs: u32,
    pub work_rounds: u32,
    pub blocked_apps: Vec<AppTarget>,
    pub blocked_domains: Vec<String>,
    pub revision: u64,
}

impl Default for FocusProfile {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            work_secs: 1500,        // 25 mins
            short_break_secs: 300,  // 5 mins
            long_break_secs: 900,   // 15 mins
            work_rounds: 4,
            blocked_apps: Vec::new(),
            blocked_domains: Vec::new(),
            revision: 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FocusPreferences {
    pub selected_profile_id: Option<String>,
    pub unblock_during_breaks: bool,
    #[serde(skip_serializing)]
    pub emergency_passphrase_hash: Option<String>,
}

impl Default for FocusPreferences {
    fn default() -> Self {
        Self {
            selected_profile_id: None,
            unblock_during_breaks: false,
            emergency_passphrase_hash: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FocusRunJournal {
    pub run_id: String,
    pub profile_snapshot_json: String,
    pub phase: String,
    pub current_round: u32,
    pub started_at: i64,
    pub lease_expires_at: i64,
}

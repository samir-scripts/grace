use rusqlite::{params, Connection, Result};

use super::model::{FocusPreferences, FocusProfile, FocusRunJournal};

pub struct FocusRepository;

impl FocusRepository {
    pub fn new() -> Self {
        Self
    }

    pub fn get_profiles(&self, conn: &Connection) -> Result<Vec<FocusProfile>> {
        let mut stmt = conn.prepare(
            "SELECT id, name, work_secs, short_break_secs, long_break_secs, work_rounds, blocked_apps_json, blocked_domains_json, revision FROM focus_profiles ORDER BY name ASC"
        )?;

        let rows = stmt.query_map([], |row| {
            let apps_json: String = row.get(6)?;
            let domains_json: String = row.get(7)?;
            let blocked_apps = serde_json::from_str(&apps_json).unwrap_or_default();
            let blocked_domains = serde_json::from_str(&domains_json).unwrap_or_default();

            Ok(FocusProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                work_secs: row.get(2)?,
                short_break_secs: row.get(3)?,
                long_break_secs: row.get(4)?,
                work_rounds: row.get(5)?,
                blocked_apps,
                blocked_domains,
                revision: row.get::<_, i64>(8)? as u64,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn get_profile(&self, conn: &Connection, id: &str) -> Result<Option<FocusProfile>> {
        let mut stmt = conn.prepare(
            "SELECT id, name, work_secs, short_break_secs, long_break_secs, work_rounds, blocked_apps_json, blocked_domains_json, revision FROM focus_profiles WHERE id = ?1"
        )?;

        let mut rows = stmt.query_map(params![id], |row| {
            let apps_json: String = row.get(6)?;
            let domains_json: String = row.get(7)?;
            let blocked_apps = serde_json::from_str(&apps_json).unwrap_or_default();
            let blocked_domains = serde_json::from_str(&domains_json).unwrap_or_default();

            Ok(FocusProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                work_secs: row.get(2)?,
                short_break_secs: row.get(3)?,
                long_break_secs: row.get(4)?,
                work_rounds: row.get(5)?,
                blocked_apps,
                blocked_domains,
                revision: row.get::<_, i64>(8)? as u64,
            })
        })?;

        if let Some(r) = rows.next() {
            Ok(Some(r?))
        } else {
            Ok(None)
        }
    }

    pub fn save_profile(&self, conn: &Connection, profile: &FocusProfile) -> Result<()> {
        let apps_json = serde_json::to_string(&profile.blocked_apps).unwrap_or_else(|_| "[]".to_string());
        let domains_json = serde_json::to_string(&profile.blocked_domains).unwrap_or_else(|_| "[]".to_string());

        conn.execute(
            "INSERT INTO focus_profiles (id, name, work_secs, short_break_secs, long_break_secs, work_rounds, blocked_apps_json, blocked_domains_json, revision)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                work_secs = excluded.work_secs,
                short_break_secs = excluded.short_break_secs,
                long_break_secs = excluded.long_break_secs,
                work_rounds = excluded.work_rounds,
                blocked_apps_json = excluded.blocked_apps_json,
                blocked_domains_json = excluded.blocked_domains_json,
                revision = excluded.revision",
            params![
                profile.id,
                profile.name,
                profile.work_secs,
                profile.short_break_secs,
                profile.long_break_secs,
                profile.work_rounds,
                apps_json,
                domains_json,
                profile.revision as i64,
            ],
        )?;

        Ok(())
    }

    pub fn delete_profile(&self, conn: &Connection, id: &str) -> Result<bool> {
        let count = conn.execute("DELETE FROM focus_profiles WHERE id = ?1", params![id])?;
        if count > 0 {
            // If the deleted profile was selected in preferences, clear it
            conn.execute(
                "UPDATE focus_preferences SET selected_profile_id = NULL WHERE selected_profile_id = ?1",
                params![id],
            )?;
        }
        Ok(count > 0)
    }

    pub fn get_preferences(&self, conn: &Connection) -> Result<FocusPreferences> {
        let mut stmt = conn.prepare(
            "SELECT selected_profile_id, unblock_during_breaks, emergency_passphrase_hash FROM focus_preferences WHERE id = 1"
        )?;

        let mut rows = stmt.query_map([], |row| {
            let unblock_num: i64 = row.get(1)?;
            Ok(FocusPreferences {
                selected_profile_id: row.get(0)?,
                unblock_during_breaks: unblock_num != 0,
                emergency_passphrase_hash: row.get(2)?,
            })
        })?;

        if let Some(r) = rows.next() {
            Ok(r?)
        } else {
            Ok(FocusPreferences::default())
        }
    }

    pub fn save_preferences(&self, conn: &Connection, prefs: &FocusPreferences) -> Result<()> {
        conn.execute(
            "INSERT INTO focus_preferences (id, selected_profile_id, unblock_during_breaks, emergency_passphrase_hash)
             VALUES (1, ?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET
                selected_profile_id = excluded.selected_profile_id,
                unblock_during_breaks = excluded.unblock_during_breaks,
                emergency_passphrase_hash = excluded.emergency_passphrase_hash",
            params![
                prefs.selected_profile_id,
                if prefs.unblock_during_breaks { 1 } else { 0 },
                prefs.emergency_passphrase_hash,
            ],
        )?;
        Ok(())
    }

    pub fn save_run_journal(&self, conn: &Connection, journal: &FocusRunJournal) -> Result<()> {
        conn.execute(
            "INSERT OR REPLACE INTO focus_run_journal (run_id, profile_snapshot_json, phase, current_round, started_at, lease_expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                journal.run_id,
                journal.profile_snapshot_json,
                journal.phase,
                journal.current_round,
                journal.started_at,
                journal.lease_expires_at,
            ],
        )?;
        Ok(())
    }

    pub fn get_run_journal(&self, conn: &Connection) -> Result<Option<FocusRunJournal>> {
        let mut stmt = conn.prepare(
            "SELECT run_id, profile_snapshot_json, phase, current_round, started_at, lease_expires_at FROM focus_run_journal LIMIT 1"
        )?;

        let mut rows = stmt.query_map([], |row| {
            Ok(FocusRunJournal {
                run_id: row.get(0)?,
                profile_snapshot_json: row.get(1)?,
                phase: row.get(2)?,
                current_round: row.get(3)?,
                started_at: row.get(4)?,
                lease_expires_at: row.get(5)?,
            })
        })?;

        if let Some(r) = rows.next() {
            Ok(Some(r?))
        } else {
            Ok(None)
        }
    }

    pub fn clear_run_journal(&self, conn: &Connection) -> Result<()> {
        conn.execute("DELETE FROM focus_run_journal", [])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::focus::model::AppTarget;

    #[test]
    fn test_migration_7_and_profile_crud() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrations::run(&conn).unwrap();

        let repo = FocusRepository::new();
        let profile = FocusProfile {
            id: "test-uuid-1".to_string(),
            name: "Deep Work".to_string(),
            work_secs: 1500,
            short_break_secs: 300,
            long_break_secs: 900,
            work_rounds: 4,
            blocked_apps: vec![AppTarget {
                id: "app-1".to_string(),
                name: "Discord".to_string(),
                identifier: "com.hnc.Discord".to_string(),
                platform: "macos".to_string(),
            }],
            blocked_domains: vec!["reddit.com".to_string(), "youtube.com".to_string()],
            revision: 1,
        };

        repo.save_profile(&conn, &profile).unwrap();
        let loaded = repo.get_profile(&conn, "test-uuid-1").unwrap().unwrap();
        assert_eq!(loaded, profile);

        // Verify update
        let mut updated = profile.clone();
        updated.name = "Deep Work 2".to_string();
        updated.revision = 2;
        repo.save_profile(&conn, &updated).unwrap();
        let loaded_updated = repo.get_profile(&conn, "test-uuid-1").unwrap().unwrap();
        assert_eq!(loaded_updated.name, "Deep Work 2");
        assert_eq!(loaded_updated.revision, 2);

        // Verify delete
        assert!(repo.delete_profile(&conn, "test-uuid-1").unwrap());
        assert_eq!(repo.get_profile(&conn, "test-uuid-1").unwrap(), None);
    }

    #[test]
    fn test_preferences_and_journal_persistence() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrations::run(&conn).unwrap();
        let repo = FocusRepository::new();

        // Default preferences
        let prefs = repo.get_preferences(&conn).unwrap();
        assert_eq!(prefs.selected_profile_id, None);
        assert!(!prefs.unblock_during_breaks);

        // Save preferences
        let updated_prefs = FocusPreferences {
            selected_profile_id: Some("prof-123".to_string()),
            unblock_during_breaks: true,
            emergency_passphrase_hash: Some("argon2id-hash-string".to_string()),
        };
        repo.save_preferences(&conn, &updated_prefs).unwrap();
        let loaded_prefs = repo.get_preferences(&conn).unwrap();
        assert_eq!(loaded_prefs.selected_profile_id, Some("prof-123".to_string()));
        assert!(loaded_prefs.unblock_during_breaks);
        assert_eq!(loaded_prefs.emergency_passphrase_hash, Some("argon2id-hash-string".to_string()));

        // Journal persistence
        assert!(repo.get_run_journal(&conn).unwrap().is_none());
        let journal = FocusRunJournal {
            run_id: "run-uuid-1".to_string(),
            profile_snapshot_json: "{}".to_string(),
            phase: "work".to_string(),
            current_round: 1,
            started_at: 1000,
            lease_expires_at: 1015,
        };
        repo.save_run_journal(&conn, &journal).unwrap();
        let loaded_journal = repo.get_run_journal(&conn).unwrap().unwrap();
        assert_eq!(loaded_journal, journal);

        repo.clear_run_journal(&conn).unwrap();
        assert!(repo.get_run_journal(&conn).unwrap().is_none());
    }
}

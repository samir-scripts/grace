use rusqlite::{Connection, Result};

/// Full schema for version 1. Tables use IF NOT EXISTS so the batch is
/// idempotent, but the schema_version check in `run()` prevents re-execution.
const MIGRATION_1: &str = "
    CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at    INTEGER NOT NULL,
        ended_at      INTEGER,
        round_type    TEXT NOT NULL CHECK(round_type IN ('work', 'short-break', 'long-break')),
        duration_secs INTEGER NOT NULL CHECK(duration_secs > 0),
        completed     INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS custom_themes (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        name   TEXT NOT NULL UNIQUE,
        colors TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_round_type ON sessions(round_type);

    INSERT INTO schema_version VALUES (1);
";

/// Migrates timer duration storage from minute-resolution keys to second-resolution keys.
/// Reads existing `time_*_mins` rows, multiplies by 60, writes `time_*_secs`, then deletes
/// the old keys so key names align with the Settings struct field names.
const MIGRATION_2: &str = "
    INSERT OR IGNORE INTO settings (key, value)
        SELECT 'time_work_secs', CAST(CAST(value AS INTEGER) * 60 AS TEXT)
          FROM settings WHERE key = 'time_work_mins';
    INSERT OR IGNORE INTO settings (key, value)
        SELECT 'time_short_break_secs', CAST(CAST(value AS INTEGER) * 60 AS TEXT)
          FROM settings WHERE key = 'time_short_break_mins';
    INSERT OR IGNORE INTO settings (key, value)
        SELECT 'time_long_break_secs', CAST(CAST(value AS INTEGER) * 60 AS TEXT)
          FROM settings WHERE key = 'time_long_break_mins';
    DELETE FROM settings WHERE key IN
        ('time_work_mins', 'time_short_break_mins', 'time_long_break_mins');
    INSERT INTO schema_version VALUES (2);
";

/// Seeds the `check_for_updates` setting for users upgrading from a version
/// that did not have this setting. Fresh installs get it via seed_defaults.
const MIGRATION_3: &str = "
    INSERT OR IGNORE INTO settings (key, value) VALUES ('check_for_updates', 'true');
    INSERT INTO schema_version VALUES (3);
";

/// Seeds the `global_shortcuts_enabled` setting for all installs. Defaults to
/// 'false' — global shortcuts are now opt-in. This is a breaking change for
/// existing users who relied on shortcuts being active by default; they must
/// re-enable them in Settings → Shortcuts.
const MIGRATION_4: &str = "
    INSERT OR IGNORE INTO settings (key, value) VALUES ('global_shortcuts_enabled', 'false');
    INSERT INTO schema_version VALUES (4);
";

/// Seeds the `short_breaks_enabled` and `long_breaks_enabled` settings for
/// users upgrading from a version that did not have these settings.
/// Both default to 'true' — existing behaviour is preserved.
const MIGRATION_5: &str = "
    INSERT OR IGNORE INTO settings (key, value) VALUES ('short_breaks_enabled', 'true');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('long_breaks_enabled', 'true');
    INSERT INTO schema_version VALUES (5);
";

/// Seeds the seven local shortcut key bindings for users upgrading from a version
/// that did not have this feature. These shortcuts are handled entirely by the frontend
/// (keydown listeners) and require no Rust-side dispatch logic.
const MIGRATION_6: &str = "
    INSERT OR IGNORE INTO settings (key, value) VALUES ('local_shortcut_toggle', ' ');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('local_shortcut_reset', 'ArrowLeft');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('local_shortcut_skip', 'ArrowRight');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('local_shortcut_volume_down', 'ArrowDown');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('local_shortcut_volume_up', 'ArrowUp');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('local_shortcut_mute', 'm');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('local_shortcut_fullscreen', 'F11');
    INSERT INTO schema_version VALUES (6);
";
/// Adds tables for Focus Profiles, Focus Preferences, and Focus Run Journal.
const MIGRATION_7: &str = "
    CREATE TABLE IF NOT EXISTS focus_profiles (
        id                   TEXT PRIMARY KEY NOT NULL,
        name                 TEXT NOT NULL,
        work_secs            INTEGER NOT NULL,
        short_break_secs     INTEGER NOT NULL,
        long_break_secs      INTEGER NOT NULL,
        work_rounds          INTEGER NOT NULL,
        blocked_apps_json    TEXT NOT NULL,
        blocked_domains_json TEXT NOT NULL,
        revision             INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS focus_preferences (
        id                        INTEGER PRIMARY KEY CHECK (id = 1),
        selected_profile_id       TEXT,
        unblock_during_breaks     INTEGER NOT NULL DEFAULT 0,
        emergency_passphrase_hash TEXT
    );

    CREATE TABLE IF NOT EXISTS focus_run_journal (
        run_id                TEXT PRIMARY KEY NOT NULL,
        profile_snapshot_json TEXT NOT NULL,
        phase                 TEXT NOT NULL,
        current_round         INTEGER NOT NULL,
        started_at            INTEGER NOT NULL,
        lease_expires_at      INTEGER NOT NULL
    );

    INSERT INTO schema_version VALUES (7);
";

/// Unifies timer duration storage into focus profiles.
/// If no profile is currently selected, preserves any legacy timer settings into a
/// new or default profile, ensures focus_preferences has a valid selection,
/// and removes obsolete duration keys from the settings table.
const MIGRATION_8: &str = "
    INSERT INTO focus_profiles (
        id, name, work_secs, short_break_secs, long_break_secs, work_rounds,
        blocked_apps_json, blocked_domains_json, revision
    )
    SELECT
        CASE WHEN EXISTS (SELECT 1 FROM focus_profiles WHERE id = 'default') THEN 'timer_default' ELSE 'default' END,
        'Pomodoro',
        COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'time_work_secs'), 1500),
        COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'time_short_break_secs'), 300),
        COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'time_long_break_secs'), 900),
        COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'work_rounds'), 4),
        '[]',
        '[]',
        1
    WHERE NOT EXISTS (
        SELECT 1 FROM focus_preferences fp
        JOIN focus_profiles p ON fp.selected_profile_id = p.id
        WHERE fp.id = 1
    );

    INSERT INTO focus_preferences (id, selected_profile_id, unblock_during_breaks)
    VALUES (
        1,
        COALESCE(
            (SELECT selected_profile_id FROM focus_preferences WHERE id = 1 AND selected_profile_id IN (SELECT id FROM focus_profiles)),
            (SELECT id FROM focus_profiles WHERE id = 'timer_default'),
            (SELECT id FROM focus_profiles WHERE id = 'default'),
            (SELECT id FROM focus_profiles LIMIT 1)
        ),
        0
    )
    ON CONFLICT(id) DO UPDATE SET
        selected_profile_id = COALESCE(
            (SELECT selected_profile_id FROM focus_preferences WHERE id = 1 AND selected_profile_id IN (SELECT id FROM focus_profiles)),
            (SELECT id FROM focus_profiles WHERE id = 'timer_default'),
            (SELECT id FROM focus_profiles WHERE id = 'default'),
            (SELECT id FROM focus_profiles LIMIT 1)
        )
    WHERE focus_preferences.selected_profile_id IS NULL
       OR focus_preferences.selected_profile_id NOT IN (SELECT id FROM focus_profiles);

    DELETE FROM settings WHERE key IN (
        'time_work_secs',
        'time_short_break_secs',
        'time_long_break_secs',
        'work_rounds'
    );

    INSERT INTO schema_version VALUES (8);
";


/// Apply any pending migrations. Each migration is wrapped in a transaction
/// so a partial failure leaves the database unchanged.
pub fn run(conn: &Connection) -> Result<()> {
    let version = current_version(conn)?;

    if version < 1 {
        log::info!("[db/migrations] applying MIGRATION_1: initial schema");
        conn.execute_batch(&format!("BEGIN; {MIGRATION_1} COMMIT;"))?;
        log::info!("[db/migrations] MIGRATION_1 complete");
    }

    if version < 2 {
        log::info!("[db/migrations] applying MIGRATION_2: timer durations minutes → seconds");
        conn.execute_batch(&format!("BEGIN; {MIGRATION_2} COMMIT;"))?;
        log::info!("[db/migrations] MIGRATION_2 complete");
    }

    if version < 3 {
        log::info!("[db/migrations] applying MIGRATION_3: seed check_for_updates setting");
        conn.execute_batch(&format!("BEGIN; {MIGRATION_3} COMMIT;"))?;
        log::info!("[db/migrations] MIGRATION_3 complete");
    }

    if version < 4 {
        log::info!("[db/migrations] applying MIGRATION_4: seed global_shortcuts_enabled setting");
        conn.execute_batch(&format!("BEGIN; {MIGRATION_4} COMMIT;"))?;
        log::info!("[db/migrations] MIGRATION_4 complete");
    }

    if version < 5 {
        log::info!("[db/migrations] applying MIGRATION_5: seed short_breaks_enabled and long_breaks_enabled");
        conn.execute_batch(&format!("BEGIN; {MIGRATION_5} COMMIT;"))?;
        log::info!("[db/migrations] MIGRATION_5 complete");
    }

    if version < 6 {
        log::info!("[db/migrations] applying MIGRATION_6: seed local shortcut key bindings");
        conn.execute_batch(&format!("BEGIN; {MIGRATION_6} COMMIT;"))?;
        log::info!("[db/migrations] MIGRATION_6 complete");
    }

    if version < 7 {
        log::info!("[db/migrations] applying MIGRATION_7: focus profiles, preferences, and journal");
        conn.execute_batch(&format!("BEGIN; {MIGRATION_7} COMMIT;"))?;
        log::info!("[db/migrations] MIGRATION_7 complete");
    }

    if version < 8 {
        log::info!("[db/migrations] applying MIGRATION_8: unify timer into focus profiles");
        conn.execute_batch(&format!("BEGIN; {MIGRATION_8} COMMIT;"))?;
        log::info!("[db/migrations] MIGRATION_8 complete");
    }

    Ok(())
}

/// Returns the current schema version, or 0 if the database is fresh.
fn current_version(conn: &Connection) -> Result<i64> {
    let table_exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='schema_version'",
        [],
        |row| row.get(0),
    )?;

    if !table_exists {
        return Ok(0);
    }

    conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_version",
        [],
        |row| row.get(0),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        for migration in [MIGRATION_1, MIGRATION_2, MIGRATION_3, MIGRATION_4, MIGRATION_5, MIGRATION_6, MIGRATION_7] {
            conn.execute_batch(migration).unwrap();
        }
        conn
    }

    #[test]
    fn upgrade_preserves_unselected_timer_and_existing_profiles() {
        let conn = legacy_database();
        conn.execute_batch("
            INSERT INTO settings VALUES ('time_work_secs', '1801'), ('time_short_break_secs', '450'),
                ('time_long_break_secs', '3900'), ('work_rounds', '6');
            INSERT INTO focus_profiles VALUES ('default', 'Existing', 1500, 300, 900, 4, '[]', '[\"example.com\"]', 7);
            INSERT INTO sessions (started_at, round_type, duration_secs, completed) VALUES (123, 'work', 1500, 1);
        ").unwrap();
        run(&conn).unwrap();
        run(&conn).unwrap();
        let (id, work, short, long, rounds, apps, domains): (String, u32, u32, u32, u32, String, String) = conn.query_row(
            "SELECT p.id, work_secs, short_break_secs, long_break_secs, work_rounds, blocked_apps_json, blocked_domains_json
             FROM focus_profiles p JOIN focus_preferences f ON p.id = f.selected_profile_id",
            [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
        ).unwrap();
        assert_ne!(id, "default");
        assert_eq!((work, short, long, rounds), (1801, 450, 3900, 6));
        assert_eq!((apps.as_str(), domains.as_str()), ("[]", "[]"));
        assert_eq!(conn.query_row("SELECT revision FROM focus_profiles WHERE id='default'", [], |r| r.get::<_, u32>(0)).unwrap(), 7);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM focus_profiles", [], |r| r.get::<_, u32>(0)).unwrap(), 2);
        assert_eq!(conn.query_row("SELECT duration_secs FROM sessions WHERE started_at=123", [], |r| r.get::<_, u32>(0)).unwrap(), 1500);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM settings WHERE key IN ('time_work_secs','time_short_break_secs','time_long_break_secs','work_rounds')", [], |r| r.get::<_, u32>(0)).unwrap(), 0);
    }

    #[test]
    fn upgrade_preserves_selected_profile_and_preferences() {
        let conn = legacy_database();
        conn.execute_batch("
            INSERT INTO focus_profiles VALUES ('chosen', 'Chosen', 2000, 400, 1000, 3, '[]', '[]', 9);
            INSERT INTO focus_preferences VALUES (1, 'chosen', 1, 'stored-hash');
        ").unwrap();
        run(&conn).unwrap();
        let (id, unblock, hash): (String, bool, String) = conn.query_row(
            "SELECT selected_profile_id, unblock_during_breaks, emergency_passphrase_hash FROM focus_preferences",
            [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        ).unwrap();
        assert_eq!((id.as_str(), unblock, hash.as_str()), ("chosen", true, "stored-hash"));
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM focus_profiles", [], |r| r.get::<_, u32>(0)).unwrap(), 1);
    }

    #[test]
    fn migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        // Second run must not error (version check prevents re-application).
        run(&conn).unwrap();
        let v: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, 8);
    }

    #[test]
    fn all_tables_created() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        for table in &["settings", "sessions", "custom_themes", "schema_version", "focus_profiles", "focus_preferences", "focus_run_journal"] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "table '{table}' was not created");
        }
    }
}

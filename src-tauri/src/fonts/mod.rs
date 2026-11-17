use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use uuid::{Uuid, Version};

use crate::settings::{self, Settings};

const MAX_FONT_SIZE: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ImportedFont {
    pub id: String,
    pub display_name: String,
}

pub fn valid_id(id: &str) -> bool {
    Uuid::parse_str(id).is_ok_and(|uuid| uuid.get_version() == Some(Version::Random) && uuid.to_string() == id)
}

pub fn exists(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    conn.query_row("SELECT EXISTS(SELECT 1 FROM imported_fonts WHERE id = ?1)", [id], |row| row.get(0))
}

pub fn list(conn: &Connection) -> Result<Vec<ImportedFont>, String> {
    let mut stmt = conn.prepare("SELECT id, display_name FROM imported_fonts ORDER BY rowid").map_err(|_| "Could not list fonts")?;
    let rows = stmt.query_map([], |row| Ok(ImportedFont { id: row.get(0)?, display_name: row.get(1)? })).map_err(|_| "Could not list fonts")?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|_| "Could not list fonts".into())
}

fn directory(app_data: &Path) -> Result<PathBuf, String> {
    let dir = app_data.join("fonts");
    fs::create_dir_all(&dir).map_err(|_| "Could not create fonts directory")?;
    let metadata = fs::symlink_metadata(&dir).map_err(|_| "Could not inspect fonts directory")?;
    if !metadata.file_type().is_dir() { return Err("Invalid fonts directory".into()); }
    Ok(dir)
}

fn read_file(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "Could not inspect font file")?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_FONT_SIZE { return Err("Invalid or oversized font file".into()); }
    let file = fs::File::open(path).map_err(|_| "Could not open font file")?;
    if !file.metadata().map_err(|_| "Could not inspect font file")?.is_file() { return Err("Invalid font file".into()); }
    let mut bytes = Vec::new();
    file.take(MAX_FONT_SIZE + 1).read_to_end(&mut bytes).map_err(|_| "Could not read font file")?;
    if bytes.len() as u64 > MAX_FONT_SIZE { return Err("Font file is too large".into()); }
    Ok(bytes)
}

fn valid_magic(extension: &str, bytes: &[u8]) -> bool {
    match extension {
        "woff" => bytes.starts_with(b"wOFF"),
        "woff2" => bytes.starts_with(b"wOF2"),
        "ttf" => bytes.starts_with(&[0, 1, 0, 0]) || bytes.starts_with(b"true"),
        "otf" => bytes.starts_with(b"OTTO"),
        _ => false,
    }
}

fn catalog_extension(conn: &Connection, id: &str) -> Result<String, String> {
    if !valid_id(id) { return Err("Invalid font ID".into()); }
    let extension: String = conn.query_row("SELECT extension FROM imported_fonts WHERE id = ?1", [id], |row| row.get(0))
        .optional().map_err(|_| "Could not find font")?.ok_or("Font not found")?;
    if !matches!(extension.as_str(), "woff" | "woff2" | "ttf" | "otf") { return Err("Invalid font catalog entry".into()); }
    Ok(extension)
}

pub fn import(conn: &Connection, app_data: &Path, source: &Path) -> Result<ImportedFont, String> {
    let extension = source.extension().and_then(|s| s.to_str()).map(str::to_ascii_lowercase).ok_or("Invalid font extension")?;
    if !matches!(extension.as_str(), "woff" | "woff2" | "ttf" | "otf") { return Err("Invalid font extension".into()); }
    let bytes = read_file(source)?;
    if !valid_magic(&extension, &bytes) { return Err("Invalid font content".into()); }
    let name: String = source.file_stem().and_then(|s| s.to_str()).unwrap_or("Font").chars()
        .filter(|c| !c.is_control() && *c != '/' && *c != '\\').take(100).collect();
    let display_name = if name.trim().is_empty() { "Font".to_string() } else { name.trim().to_string() };
    let id = Uuid::new_v4().to_string();
    let dir = directory(app_data)?;
    let temp = dir.join(format!(".{id}.tmp"));
    let final_path = dir.join(format!("{id}.{extension}"));
    let mut temp_created = false;
    let mut final_created = false;
    let result = (|| {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|_| "Could not create font file")?;
        temp_created = true;
        file.write_all(&bytes).map_err(|_| "Could not write font file")?;
        drop(file);
        let tx = conn.unchecked_transaction().map_err(|_| "Could not import font")?;
        tx.execute("INSERT INTO imported_fonts (id, display_name, extension) VALUES (?1, ?2, ?3)", params![id, display_name, extension]).map_err(|_| "Could not import font")?;
        fs::hard_link(&temp, &final_path).map_err(|_| "Could not store font file")?;
        final_created = true;
        fs::remove_file(&temp).map_err(|_| "Could not store font file")?;
        temp_created = false;
        tx.commit().map_err(|_| "Could not import font")?;
        Ok(ImportedFont { id, display_name })
    })();
    if result.is_err() {
        if temp_created { let _ = fs::remove_file(&temp); }
        if final_created { let _ = fs::remove_file(&final_path); }
    }
    result
}

pub fn read(conn: &Connection, app_data: &Path, id: &str) -> Result<Vec<u8>, String> {
    let extension = catalog_extension(conn, id)?;
    let bytes = read_file(&directory(app_data)?.join(format!("{id}.{extension}")))?;
    if !valid_magic(&extension, &bytes) { return Err("Invalid font content".into()); }
    Ok(bytes)
}

pub fn remove(conn: &Connection, app_data: &Path, id: &str) -> Result<Settings, String> {
    let extension = catalog_extension(conn, id)?;
    let dir = directory(app_data)?;
    let path = dir.join(format!("{id}.{extension}"));
    let bytes = read_file(&path)?;
    let tombstone = dir.join(format!(".{}.removed", Uuid::new_v4()));
    fs::rename(&path, &tombstone).map_err(|_| "Could not remove font file")?;
    let result = (|| {
        let tx = conn.unchecked_transaction().map_err(|_| "Could not remove font")?;
        tx.execute("DELETE FROM imported_fonts WHERE id = ?1", [id]).map_err(|_| "Could not remove font")?;
        tx.execute("UPDATE settings SET value = 'mona-sans' WHERE key = 'font_pack' AND value = ?1", [format!("custom:{id}")]).map_err(|_| "Could not update font selection")?;
        let snapshot = settings::load(&tx).map_err(|_| "Could not load settings")?;
        fs::remove_file(&tombstone).map_err(|_| "Could not remove font file")?;
        if tx.commit().is_err() {
            let mut file = OpenOptions::new().write(true).create_new(true).open(&path).map_err(|_| "Could not restore font file")?;
            file.write_all(&bytes).map_err(|_| "Could not restore font file")?;
            return Err("Could not remove font".into());
        }
        Ok(snapshot)
    })();
    if result.is_err() && tombstone.exists() {
        fs::rename(&tombstone, &path).map_err(|_| "Could not restore font file")?;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    struct Fixture { conn: Connection, dir: PathBuf }
    impl Fixture {
        fn new() -> Self {
            let conn = Connection::open_in_memory().unwrap();
            migrations::run(&conn).unwrap();
            settings::seed_defaults(&conn).unwrap();
            let dir = std::env::temp_dir().join(format!("grace-font-test-{}", Uuid::new_v4()));
            fs::create_dir(&dir).unwrap();
            Self { conn, dir }
        }
        fn source(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.dir.join(name); fs::write(&path, bytes).unwrap(); path
        }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.dir); } }

    #[test]
    fn imports_reads_selects_and_removes_distinct_fonts() {
        let f = Fixture::new();
        let src = f.source("Face.ttf", &[0, 1, 0, 0, 5]);
        let a = import(&f.conn, &f.dir, &src).unwrap();
        let b = import(&f.conn, &f.dir, &src).unwrap();
        assert_ne!(a.id, b.id);
        assert_eq!(list(&f.conn).unwrap(), vec![a.clone(), b.clone()]);
        assert_eq!(read(&f.conn, &f.dir, &a.id).unwrap(), vec![0, 1, 0, 0, 5]);
        let selected = format!("custom:{}", a.id);
        settings::validate_appearance(&f.conn, "font_pack", &selected).unwrap();
        settings::save_setting(&f.conn, "font_pack", &selected).unwrap();
        assert_eq!(settings::load(&f.conn).unwrap().font_pack, selected);
        assert_eq!(remove(&f.conn, &f.dir, &a.id).unwrap().font_pack, "mona-sans");
        assert_eq!(list(&f.conn).unwrap(), vec![b]);
    }

    #[test]
    fn accepts_each_supported_signature_and_rejects_missing_files() {
        let f = Fixture::new();
        for (name, bytes) in [
            ("one.woff", b"wOFF".as_slice()),
            ("two.woff2", b"wOF2"),
            ("three.ttf", b"true"),
            ("four.otf", b"OTTO"),
        ] {
            let src = f.source(name, bytes);
            let font = import(&f.conn, &f.dir, &src).unwrap();
            assert_eq!(read(&f.conn, &f.dir, &font.id).unwrap(), bytes);
        }
        let font = list(&f.conn).unwrap().remove(0);
        let selected = format!("custom:{}", font.id);
        settings::save_setting(&f.conn, "font_pack", &selected).unwrap();
        fs::remove_file(f.dir.join("fonts").join(format!("{}.woff", font.id))).unwrap();
        assert!(read(&f.conn, &f.dir, &font.id).is_err());
        assert!(remove(&f.conn, &f.dir, &font.id).is_err());
        assert_eq!(settings::load(&f.conn).unwrap().font_pack, selected);
        assert_eq!(list(&f.conn).unwrap().len(), 4);
    }

    #[test]
    fn rejects_bad_magic_oversized_files_and_unsafe_ids() {
        let f = Fixture::new();
        for (name, bytes) in [("bad.ttf", b"ttcf".as_slice()), ("bad.woff", b"wOF2"), ("bad.otf", b"true"), ("bad.ttc", b"ttcf")] {
            let path = f.source(name, bytes);
            assert!(import(&f.conn, &f.dir, &path).is_err());
        }
        let huge = f.source("huge.ttf", &[0, 1, 0, 0]);
        OpenOptions::new().write(true).open(&huge).unwrap().set_len(MAX_FONT_SIZE + 1).unwrap();
        assert!(import(&f.conn, &f.dir, &huge).is_err());
        for id in ["../outside", "not-a-uuid", "00000000-0000-0000-0000-000000000000"] {
            assert!(read(&f.conn, &f.dir, id).is_err());
            assert!(remove(&f.conn, &f.dir, id).is_err());
        }
        assert!(list(&f.conn).unwrap().is_empty());
    }

    #[test]
    fn failed_destination_write_leaves_catalog_and_selection_unchanged() {
        let f = Fixture::new();
        let source = f.source("font.ttf", &[0, 1, 0, 0]);
        fs::write(f.dir.join("fonts"), b"not a directory").unwrap();
        assert!(import(&f.conn, &f.dir, &source).is_err());
        assert!(list(&f.conn).unwrap().is_empty());
        assert_eq!(settings::load(&f.conn).unwrap().font_pack, "mona-sans");
    }

    #[test]
    fn failure_rolls_back_file_and_catalog() {
        let f = Fixture::new();
        let src = f.source("face.woff2", b"wOF2data");
        f.conn.execute_batch("CREATE TRIGGER reject_import BEFORE INSERT ON imported_fonts BEGIN SELECT RAISE(ABORT, 'no'); END;").unwrap();
        assert!(import(&f.conn, &f.dir, &src).is_err());
        assert_eq!(fs::read_dir(f.dir.join("fonts")).unwrap().count(), 0);
        f.conn.execute_batch("DROP TRIGGER reject_import;").unwrap();
        let font = import(&f.conn, &f.dir, &src).unwrap();
        settings::save_setting(&f.conn, "font_pack", &format!("custom:{}", font.id)).unwrap();
        f.conn.execute_batch("CREATE TRIGGER reject_delete BEFORE DELETE ON imported_fonts BEGIN SELECT RAISE(ABORT, 'no'); END;").unwrap();
        assert!(remove(&f.conn, &f.dir, &font.id).is_err());
        assert_eq!(read(&f.conn, &f.dir, &font.id).unwrap(), b"wOF2data");
        assert_eq!(settings::load(&f.conn).unwrap().font_pack, format!("custom:{}", font.id));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_for_import_and_catalog_file() {
        use std::os::unix::fs::symlink;
        let f = Fixture::new();
        let src = f.source("face.ttf", &[0, 1, 0, 0]);
        let link = f.dir.join("link.ttf");
        symlink(&src, &link).unwrap();
        assert!(import(&f.conn, &f.dir, &link).is_err());
        let font = import(&f.conn, &f.dir, &src).unwrap();
        let stored = f.dir.join("fonts").join(format!("{}.ttf", font.id));
        fs::remove_file(&stored).unwrap();
        symlink(&src, &stored).unwrap();
        assert!(read(&f.conn, &f.dir, &font.id).is_err());
        assert!(remove(&f.conn, &f.dir, &font.id).is_err());
        assert!(src.exists());
    }
}

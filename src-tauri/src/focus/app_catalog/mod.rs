//! Read-only installed application catalog. IPC accepts catalog IDs, never filesystem paths.
use std::collections::HashMap;
#[cfg(any(target_os = "macos", target_os = "windows", test))]
use std::collections::BTreeMap;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use base64::Engine;
use serde::{Deserialize, Serialize};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

const MAX_ICON_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct InstalledApplication {
    pub id: String,
    pub name: String,
    pub identifier: String,
    pub platform: String,
    pub path: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct ApplicationCatalog {
    pub applications: Vec<InstalledApplication>,
    pub warnings: Vec<String>,
}

#[derive(Default)]
struct CatalogCache {
    catalog: ApplicationCatalog,
    icons: HashMap<String, Option<String>>,
}

impl CatalogCache {
    #[cfg(any(target_os = "macos", target_os = "windows", test))]
    fn replace(&mut self, catalog: ApplicationCatalog) {
        self.icons.retain(|id, _| {
            catalog.applications.iter().any(|new| {
                new.id == *id && self.catalog.applications.iter().any(|old| old == new)
            })
        });
        self.catalog = catalog;
    }

    fn icon_with(
        &mut self,
        id: &str,
        load: impl FnOnce(&InstalledApplication) -> Result<Option<Vec<u8>>, String>,
    ) -> Result<Option<String>, String> {
        let app = self.catalog.applications.iter().find(|app| app.id == id)
            .ok_or_else(|| "Unknown application catalog ID; refresh the application list".to_string())?;
        if let Some(icon) = self.icons.get(id) {
            return Ok(icon.clone());
        }
        let icon = load(app)?.filter(|bytes| bytes.len() <= MAX_ICON_BYTES)
            .map(|bytes| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)));
        self.icons.insert(id.to_owned(), icon.clone());
        Ok(icon)
    }
}

fn cache() -> &'static Mutex<CatalogCache> {
    static CACHE: LazyLock<Mutex<CatalogCache>> = LazyLock::new(|| Mutex::new(CatalogCache::default()));
    &CACHE
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
fn normalize_catalog(entries: Vec<Result<InstalledApplication, String>>) -> ApplicationCatalog {
    let mut catalog = ApplicationCatalog::default();
    let mut identities = BTreeMap::new();
    // Choose the same copy regardless of directory enumeration order.
    let mut entries = entries;
    entries.sort_by(|a, b| match (a, b) {
        (Ok(a), Ok(b)) => a.path.cmp(&b.path),
        (Ok(_), Err(_)) => std::cmp::Ordering::Less,
        (Err(_), Ok(_)) => std::cmp::Ordering::Greater,
        (Err(a), Err(b)) => a.cmp(b),
    });
    for entry in entries {
        let mut app = match entry {
            Ok(app) => app,
            Err(warning) => { catalog.warnings.push(warning); continue; }
        };
        if app.name.trim().is_empty() || app.identifier.trim().is_empty() || app.path.is_empty() {
            catalog.warnings.push(format!("Incomplete application metadata: {}", app.path));
            continue;
        }
        if app.platform == "windows" {
            app.identifier = app.identifier.to_ascii_lowercase();
        }
        let identity = format!("{}:{}", app.platform, app.identifier);
        app.id = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(identity.as_bytes());
        identities.entry(identity).or_insert(app);
    }
    catalog.applications = identities.into_values().collect();
    // Stable sort retains the BTreeMap's enforcement-identity order for equal names.
    catalog.applications.sort_by_cached_key(|app| app.name.to_lowercase());
    catalog
}

// Do not follow directory links or descend into bundles. Missing roots are normal.
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn walk_candidates(root: &Path, extension: &str, entries: &mut Vec<Result<PathBuf, String>>) {
    match root.symlink_metadata() {
        Ok(meta) if meta.file_type().is_symlink() => return,
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => { entries.push(Err(format!("{}: {error}", root.display()))); return; }
    }
    let children = match std::fs::read_dir(root) {
        Ok(children) => children,
        Err(error) => { entries.push(Err(format!("{}: {error}", root.display()))); return; }
    };
    for child in children {
        let child = match child {
            Ok(child) => child,
            Err(error) => { entries.push(Err(format!("{}: {error}", root.display()))); continue; }
        };
        let path = child.path();
        let kind = match child.file_type() {
            Ok(kind) => kind,
            Err(error) => { entries.push(Err(format!("{}: {error}", path.display()))); continue; }
        };
        if kind.is_symlink() { continue; }
        if path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case(extension)) {
            entries.push(Ok(path));
        } else if kind.is_dir() {
            walk_candidates(&path, extension, entries);
        }
    }
}

pub fn list() -> Result<ApplicationCatalog, String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let mut cache = cache().lock().map_err(|_| "Application catalog cache unavailable")?;
        #[cfg(target_os = "macos")]
        let catalog = macos::discover();
        #[cfg(target_os = "windows")]
        let catalog = windows::discover()?;
        cache.replace(catalog);
        Ok(cache.catalog.clone())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    Err("Installed application discovery is not supported on this platform".into())
}

pub fn icon(id: &str) -> Result<Option<String>, String> {
    let mut cache = cache().lock().map_err(|_| "Application catalog cache unavailable")?;
    cache.icon_with(id, |app| {
        #[cfg(target_os = "macos")]
        return macos::icon(app);
        #[cfg(target_os = "windows")]
        return windows::icon(app);
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        { let _ = app; Err("Installed application icons are not supported on this platform".into()) }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(name: &str, identifier: &str, path: &str, platform: &str) -> InstalledApplication {
        InstalledApplication { id: String::new(), name: name.into(), identifier: identifier.into(), platform: platform.into(), path: path.into() }
    }

    #[test]
    fn test_catalog_deduplicates_identity_not_name() {
        let catalog = normalize_catalog(vec![
            Ok(app("Editor", "com.example.editor", "/Applications/Editor.app", "macos")),
            Ok(app("Editor Copy", "com.example.editor", "/Users/me/Applications/Editor.app", "macos")),
            Ok(app("Editor", "org.other.editor", "/Applications/Other.app", "macos")),
            Ok(app("Browser", "Browser.EXE", "C:\\Apps\\Browser.exe", "windows")),
            Ok(app("Browser Copy", "browser.exe", "D:\\Apps\\browser.exe", "windows")),
        ]);
        assert_eq!(catalog.applications.len(), 3);
        assert_eq!(catalog.applications.iter().filter(|a| a.name == "Editor").count(), 2);
        let again = normalize_catalog(catalog.applications.clone().into_iter().rev().map(Ok).collect());
        assert_eq!(catalog.applications, again.applications);
        assert_ne!(catalog.applications[1].id, catalog.applications[2].id);
    }

    #[test]
    fn test_catalog_survives_bad_entry() {
        let catalog = normalize_catalog(vec![
            Err("Malformed bundle: /Applications/Bad.app".into()),
            Ok(app("Good", "com.example.good", "/Applications/Good.app", "macos")),
            Ok(app("Invalid", "", "/Applications/Invalid.app", "macos")),
        ]);
        assert_eq!(catalog.applications.len(), 1);
        assert_eq!(catalog.applications[0].name, "Good");
        assert_eq!(catalog.warnings.len(), 2);
    }

    #[test]
    fn test_catalog_rejects_unknown_icon_id() {
        let mut cache = CatalogCache::default();
        let result = cache.icon_with("../../private/file", |_| panic!("unknown IDs must not read paths"));
        assert!(result.unwrap_err().contains("Unknown application"));
    }

    #[test]
    fn test_catalog_caches_missing_icon() {
        let mut cache = CatalogCache::default();
        cache.replace(normalize_catalog(vec![Ok(app("No logo", "com.example.none", "/Applications/None.app", "macos"))]));
        let id = cache.catalog.applications[0].id.clone();
        assert_eq!(cache.icon_with(&id, |_| Ok(None)).unwrap(), None);
        assert_eq!(cache.icon_with(&id, |_| panic!("missing icons must be cached")).unwrap(), None);
    }

    #[test]
    fn test_catalog_rejects_oversized_icon() {
        let mut cache = CatalogCache::default();
        cache.replace(normalize_catalog(vec![Ok(app("Large logo", "com.example.large", "/Applications/Large.app", "macos"))]));
        let id = cache.catalog.applications[0].id.clone();
        assert_eq!(cache.icon_with(&id, |_| Ok(Some(vec![0; MAX_ICON_BYTES + 1]))).unwrap(), None);
    }

    /// Read-only device acceptance path, deliberately opt-in; never constructs an enforcer.
    #[test]
    #[ignore = "reads the real device application catalog and native icons"]
    fn native_catalog_smoke() {
        let catalog = list().expect("native catalog unavailable");
        assert!(!catalog.applications.is_empty(), "no installed applications discovered: {:?}", catalog.warnings);
        let mut logos = 0;
        for app in &catalog.applications {
            let icon = icon(&app.id).expect("known icon ID failed");
            if let Some(url) = icon {
                use base64::Engine;
                let bytes = base64::engine::general_purpose::STANDARD.decode(url.strip_prefix("data:image/png;base64,").unwrap()).unwrap();
                assert!(bytes.len() <= MAX_ICON_BYTES);
                assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
                assert_eq!(u32::from_be_bytes(bytes[16..20].try_into().unwrap()), 32);
                assert_eq!(u32::from_be_bytes(bytes[20..24].try_into().unwrap()), 32);
                logos += 1;
            }
            println!("{} | {} | {}", app.name, app.identifier, app.path);
        }
        println!("{} applications, {logos} real logos, warnings: {:?}", catalog.applications.len(), catalog.warnings);
        assert!(logos > 0, "no device logos extracted");
    }
}

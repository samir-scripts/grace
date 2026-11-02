use std::path::Path;

use objc2::{rc::autoreleasepool, AnyThread};
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSDeviceRGBColorSpace, NSGraphicsContext, NSWorkspace};
use objc2_foundation::{NSBundle, NSDictionary, NSPoint, NSRect, NSSize, NSString};

use super::{normalize_catalog, walk_candidates, ApplicationCatalog, InstalledApplication, MAX_ICON_BYTES};

fn bundle_string(bundle: &NSBundle, key: &str) -> Option<String> {
    bundle.objectForInfoDictionaryKey(&NSString::from_str(key))?
        .downcast_ref::<NSString>().map(|value| value.to_string()).filter(|value| !value.trim().is_empty())
}

fn read_bundle(path: &Path) -> Result<InstalledApplication, String> {
    let fail = || format!("Malformed application bundle: {}", path.display());
    let bundle = NSBundle::bundleWithPath(&NSString::from_str(&path.to_string_lossy())).ok_or_else(fail)?;
    let identifier = bundle_string(&bundle, "CFBundleIdentifier").ok_or_else(fail)?;
    let executable_name = bundle_string(&bundle, "CFBundleExecutable").ok_or_else(fail)?;
    if Path::new(&executable_name).file_name().and_then(|name| name.to_str()) != Some(executable_name.as_str()) {
        return Err(fail());
    }
    let executable = bundle.executablePath().ok_or_else(fail)?;
    if !Path::new(&executable.to_string()).is_file() {
        return Err(fail());
    }
    let name = bundle_string(&bundle, "CFBundleDisplayName")
        .or_else(|| bundle_string(&bundle, "CFBundleName"))
        .or_else(|| path.file_stem().map(|name| name.to_string_lossy().into_owned())).ok_or_else(fail)?;
    Ok(InstalledApplication { id: String::new(), name, identifier, platform: "macos".into(), path: path.to_string_lossy().into_owned() })
}

pub(super) fn discover() -> ApplicationCatalog {
    autoreleasepool(|_| {
        let mut candidates = Vec::new();
        for root in [Path::new("/Applications"), Path::new("/System/Applications")] {
            walk_candidates(root, "app", &mut candidates);
        }
        if let Some(home) = std::env::var_os("HOME") {
            walk_candidates(&Path::new(&home).join("Applications"), "app", &mut candidates);
        }
        normalize_catalog(candidates.into_iter().map(|path| path.and_then(|path| read_bundle(&path))).collect())
    })
}

pub(super) fn icon(app: &InstalledApplication) -> Result<Option<Vec<u8>>, String> {
    autoreleasepool(|_| {
        let path = Path::new(&app.path);
        if !path.is_dir() { return Ok(None); }
        let Some(bundle) = NSBundle::bundleWithPath(&NSString::from_str(&app.path)) else { return Ok(None); };
        // Do not return the workspace's generic document icon as a real application logo.
        let file_icon = bundle_string(&bundle, "CFBundleIconFile").is_some_and(|name| {
            let name = NSString::from_str(&name);
            bundle.pathForResource_ofType(Some(&name), None)
                .or_else(|| bundle.pathForResource_ofType(Some(&name), Some(&NSString::from_str("icns"))))
                .is_some_and(|path| Path::new(&path.to_string()).is_file())
        });
        let asset_icon = (bundle_string(&bundle, "CFBundleIconName").is_some()
            || bundle.objectForInfoDictionaryKey(&NSString::from_str("CFBundleIcons")).is_some())
            && bundle.pathForResource_ofType(Some(&NSString::from_str("Assets")), Some(&NSString::from_str("car"))).is_some();
        if !file_icon && !asset_icon { return Ok(None); }
        let image = NSWorkspace::sharedWorkspace().iconForFile(&NSString::from_str(&app.path));
        // Offscreen bitmap contexts are thread-local and do not require a window or NSApplication.
        let bitmap = unsafe {
            NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
                NSBitmapImageRep::alloc(), std::ptr::null_mut(), 32, 32, 8, 4, true, false, NSDeviceRGBColorSpace, 128, 32,
            )
        };
        let Some(bitmap) = bitmap else { return Ok(None); };
        let pixels = bitmap.bitmapData();
        if pixels.is_null() { return Ok(None); }
        // AppKit may leave allocated planes uninitialized; clear transparent pixels too.
        unsafe { std::ptr::write_bytes(pixels, 0, 32 * 32 * 4); }
        let Some(context) = NSGraphicsContext::graphicsContextWithBitmapImageRep(&bitmap) else { return Ok(None); };
        NSGraphicsContext::saveGraphicsState_class();
        NSGraphicsContext::setCurrentContext(Some(&context));
        image.drawInRect(NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(32.0, 32.0)));
        NSGraphicsContext::restoreGraphicsState_class();
        let png = unsafe { bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) };
        Ok(png.filter(|data| data.length() <= MAX_ICON_BYTES).map(|data| data.to_vec()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_bundle_is_warning_not_catalog_failure() {
        let root = std::env::temp_dir().join(format!("pomotroid-catalog-{}", uuid::Uuid::new_v4()));
        let bad = root.join("Nested/Bad.app");
        std::fs::create_dir_all(bad.join("Contents")).unwrap();
        std::fs::write(bad.join("Contents/Info.plist"), b"not a plist").unwrap();
        // Bundles are terminal: a nested application inside Bad.app must not be traversed.
        std::fs::create_dir_all(bad.join("Hidden.app")).unwrap();
        std::os::unix::fs::symlink(&root, root.join("Nested/Loop")).unwrap();
        let mut candidates = Vec::new();
        walk_candidates(&root, "app", &mut candidates);
        assert_eq!(candidates.len(), 1);
        assert!(read_bundle(&bad).is_err());
        let catalog = normalize_catalog(candidates.into_iter().map(|entry| entry.and_then(|path| read_bundle(&path))).collect());
        assert!(catalog.applications.is_empty());
        assert_eq!(catalog.warnings.len(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn bundle_without_icon_returns_none() {
        let root = std::env::temp_dir().join(format!("pomotroid-catalog-{}", uuid::Uuid::new_v4()));
        let bundle = root.join("NoIcon.app");
        std::fs::create_dir_all(bundle.join("Contents/MacOS")).unwrap();
        std::fs::write(bundle.join("Contents/MacOS/NoIcon"), b"").unwrap();
        std::fs::write(bundle.join("Contents/Info.plist"), br#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>org.pomotroid.catalog.no-icon</string>
<key>CFBundleExecutable</key><string>NoIcon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleName</key><string>No Icon</string>
</dict></plist>"#).unwrap();
        let app = read_bundle(&bundle).unwrap();
        assert_eq!(app.identifier, "org.pomotroid.catalog.no-icon");
        assert_eq!(icon(&app).unwrap(), None);
        std::fs::remove_dir_all(root).unwrap();
    }
}

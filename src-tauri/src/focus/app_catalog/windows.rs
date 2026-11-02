use std::ffi::OsString;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};

use windows::core::{Interface, PCWSTR};
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, STGM_READ};
use windows::Win32::System::Environment::ExpandEnvironmentStringsW;
use windows::Win32::UI::Shell::{FOLDERID_CommonPrograms, FOLDERID_Programs, IShellLinkW, KF_FLAG_DONT_VERIFY, SHDefExtractIconW, SHGetKnownFolderPath, ShellLink, SLGP_RAWPATH};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, DrawIconEx, HICON, DI_NORMAL};

use super::{normalize_catalog, walk_candidates, ApplicationCatalog, InstalledApplication};

struct ComApartment;
impl ComApartment {
    fn new() -> Result<Self, String> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok().map_err(|e| format!("Cannot initialize application discovery: {e}"))?; }
        Ok(Self)
    }
}
impl Drop for ComApartment {
    fn drop(&mut self) { unsafe { CoUninitialize(); } }
}

fn wide(path: &Path) -> Vec<u16> { path.as_os_str().encode_wide().chain(Some(0)).collect() }

fn read_shortcut(path: &Path) -> Result<InstalledApplication, String> {
    let result = (|| -> windows::core::Result<InstalledApplication> {
        unsafe {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            let file: IPersistFile = link.cast()?;
            file.Load(PCWSTR(wide(path).as_ptr()), STGM_READ)?;
            let mut target = vec![0u16; 32768];
            // No Resolve(): it may search network shares, update links or display UI.
            link.GetPath(&mut target, std::ptr::null_mut(), SLGP_RAWPATH.0 as u32)?;
            let required = ExpandEnvironmentStringsW(PCWSTR(target.as_ptr()), None);
            if required == 0 || required > 32768 { return Err(windows::core::Error::from_thread()); }
            let mut expanded = vec![0u16; required as usize];
            if ExpandEnvironmentStringsW(PCWSTR(target.as_ptr()), Some(&mut expanded)) != required {
                return Err(windows::core::Error::from_thread());
            }
            let target = PathBuf::from(OsString::from_wide(&expanded[..expanded.len() - 1]));
            if !target.is_absolute() || !target.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("exe")) || !target.is_file() {
                return Err(windows::core::Error::new(windows::core::HRESULT(0x80070057u32 as i32), "Shortcut has no installed executable target"));
            }
            // taskkill /IM matches the image basename, not an executable's full path.
            let identifier = target.file_name().unwrap().to_string_lossy().into_owned();
            let name = path.file_stem().unwrap_or_default().to_string_lossy().into_owned();
            Ok(InstalledApplication { id: String::new(), name, identifier, platform: "windows".into(), path: target.to_string_lossy().into_owned() })
        }
    })();
    result.map_err(|error| format!("{}: {error}", path.display()))
}

pub(super) fn discover() -> Result<ApplicationCatalog, String> {
    let _apartment = ComApartment::new()?;
    let mut candidates = Vec::new();
    for folder in [FOLDERID_Programs, FOLDERID_CommonPrograms] {
        unsafe {
            match SHGetKnownFolderPath(&folder, KF_FLAG_DONT_VERIFY, None) {
                Ok(raw) => {
                    let path = raw.to_string();
                    CoTaskMemFree(Some(raw.0.cast()));
                    match path {
                        Ok(path) => walk_candidates(Path::new(&path), "lnk", &mut candidates),
                        Err(error) => candidates.push(Err(format!("Invalid Start Menu path: {error}"))),
                    }
                }
                Err(error) => candidates.push(Err(format!("Cannot read Start Menu location: {error}"))),
            }
        }
    }
    Ok(normalize_catalog(candidates.into_iter().map(|entry| entry.and_then(|path| read_shortcut(&path))).collect()))
}

struct OwnedIcon(HICON);
impl Drop for OwnedIcon {
    fn drop(&mut self) { unsafe { let _ = DestroyIcon(self.0); } }
}

// Render on both black and white to recover alpha even for legacy masked icons.
fn render(icon: HICON, background: u8) -> windows::core::Result<Vec<u8>> {
    unsafe {
        let dc = CreateCompatibleDC(None);
        if dc.is_invalid() { return Err(windows::core::Error::from_thread()); }
        let info = BITMAPINFO { bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: 32, biHeight: -32, biPlanes: 1, biBitCount: 32,
            biCompression: BI_RGB.0, ..Default::default()
        }, ..Default::default() };
        let mut bits = std::ptr::null_mut();
        let bitmap = match CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0) {
            Ok(bitmap) => bitmap,
            Err(error) => { let _ = DeleteDC(dc); return Err(error); }
        };
        let previous = SelectObject(dc, HGDIOBJ(bitmap.0));
        let pixels = std::slice::from_raw_parts_mut(bits.cast::<u8>(), 32 * 32 * 4);
        pixels.fill(background);
        let result = DrawIconEx(dc, 0, 0, icon, 32, 32, 0, None, DI_NORMAL).map(|_| pixels.to_vec());
        SelectObject(dc, previous);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(dc);
        result
    }
}

pub(super) fn icon(app: &InstalledApplication) -> Result<Option<Vec<u8>>, String> {
    let path = Path::new(&app.path);
    if !path.is_file() { return Ok(None); }
    let mut handle = HICON::default();
    let extracted = unsafe { SHDefExtractIconW(PCWSTR(wide(path).as_ptr()), 0, 0, Some(&mut handle), None, 32) };
    if extracted.is_err() || handle.is_invalid() { return Ok(None); }
    let handle = OwnedIcon(handle);
    let (Ok(black), Ok(white)) = (render(handle.0, 0), render(handle.0, 255)) else { return Ok(None); };
    let mut pixmap = tiny_skia::Pixmap::new(32, 32).ok_or("Cannot allocate application icon")?;
    for ((out, black), white) in pixmap.data_mut().chunks_exact_mut(4).zip(black.chunks_exact(4)).zip(white.chunks_exact(4)) {
        let transparency = (0..3).map(|channel| white[channel].saturating_sub(black[channel])).max().unwrap();
        let alpha = 255 - transparency;
        out.copy_from_slice(&[black[2].min(alpha), black[1].min(alpha), black[0].min(alpha), alpha]);
    }
    pixmap.encode_png().map(Some).map_err(|error| format!("Cannot encode application icon: {error}"))
}

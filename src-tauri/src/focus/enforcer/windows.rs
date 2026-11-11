#[cfg(target_os = "windows")]
mod application {
    use crate::focus::model::AppTarget;
    use super::super::{apps::{ProcessBackend, RunningProcess}, EnforcerError};
    use windows::Win32::{
        Foundation::{CloseHandle, HANDLE, FILETIME, ERROR_NO_MORE_FILES, ERROR_INVALID_PARAMETER, HWND, LPARAM, BOOL},
        Security::{EqualSid, GetTokenInformation, TokenSessionId, TokenUser, TOKEN_QUERY, TOKEN_USER},
        System::{Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS},
            Threading::{GetCurrentProcess, GetProcessTimes, OpenProcess, OpenProcessToken, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE}},
        UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId, PostMessageW, WM_CLOSE},
    };

    struct Handle(HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) { unsafe { let _ = CloseHandle(self.0); } }
    }
    fn failure(error: windows::core::Error) -> EnforcerError {
        EnforcerError::ProcessTerminationFailed(error.to_string())
    }
    fn token(process: HANDLE) -> Result<Handle, EnforcerError> {
        let mut handle = HANDLE::default();
        unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut handle).map_err(failure)?; }
        Ok(Handle(handle))
    }
    fn token_user(token: HANDLE) -> Result<Vec<usize>, EnforcerError> {
        let mut size = 0;
        unsafe { let _ = GetTokenInformation(token, TokenUser, None, 0, &mut size); }
        if size == 0 || size > 4096 { return Err(EnforcerError::NotAuthorized); }
        let words = (size as usize).div_ceil(std::mem::size_of::<usize>());
        let mut buffer = vec![0usize; words];
        unsafe { GetTokenInformation(token, TokenUser, Some(buffer.as_mut_ptr().cast()), size, &mut size).map_err(failure)?; }
        Ok(buffer)
    }
    fn session(token: HANDLE) -> Result<u32, EnforcerError> {
        let mut session = 0u32;
        let mut size = 0;
        unsafe { GetTokenInformation(token, TokenSessionId, Some((&mut session as *mut u32).cast()), 4, &mut size).map_err(failure)?; }
        Ok(session)
    }
    fn identity(handle: HANDLE, pid: u32) -> Result<RunningProcess, EnforcerError> {
        let (mut created, mut exited, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
        unsafe { GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user).map_err(failure)?; }
        Ok(RunningProcess { pid, start_id: ((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64 })
    }

    pub(crate) struct ApplicationBackend { names: Vec<String> }
    impl ApplicationBackend {
        pub(crate) fn new(targets: Vec<AppTarget>) -> Result<Self, EnforcerError> {
            let self_name = std::env::current_exe().map_err(|e| EnforcerError::InvalidTarget(e.to_string()))?
                .file_name().ok_or_else(|| EnforcerError::InvalidTarget("Unknown executable identity".into()))?.to_string_lossy().to_lowercase();
            let mut names = Vec::with_capacity(targets.len());
            for target in targets {
                let name = target.identifier.trim().to_lowercase();
                if !matches!(target.platform.as_str(), "windows" | "all") || !name.ends_with(".exe")
                    || name.contains(['/', '\\', '*', '?', ':']) || name == self_name
                    || name == "pomotroid-focus-helper.exe" {
                    return Err(EnforcerError::InvalidTarget(target.name));
                }
                if !names.contains(&name) { names.push(name); }
            }
            Ok(Self { names })
        }
        fn owned(&self, process: HANDLE) -> Result<bool, EnforcerError> {
            let current = token(unsafe { GetCurrentProcess() })?;
            let candidate = token(process)?;
            if session(current.0)? != session(candidate.0)? { return Ok(false); }
            let current_user = token_user(current.0)?;
            let candidate_user = token_user(candidate.0)?;
            // TOKEN_USER stores a SID pointer into the heap buffer returned by GetTokenInformation.
            let current_user = unsafe { &*current_user.as_ptr().cast::<TOKEN_USER>() };
            let candidate_user = unsafe { &*candidate_user.as_ptr().cast::<TOKEN_USER>() };
            Ok(unsafe { EqualSid(current_user.User.Sid, candidate_user.User.Sid) }.is_ok())
        }
    }
    impl ProcessBackend for ApplicationBackend {
        fn snapshot(&mut self) -> Result<Vec<RunningProcess>, EnforcerError> {
            let snapshot = Handle(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).map_err(failure)? });
            let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
            let mut result = Vec::new();
            let mut next = unsafe { Process32FirstW(snapshot.0, &mut entry) };
            loop {
                if let Err(error) = next {
                    if error.code() == windows::core::HRESULT::from_win32(ERROR_NO_MORE_FILES.0) { break; }
                    return Err(failure(error));
                }
                let end = entry.szExeFile.iter().position(|c| *c == 0).unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..end]);
                if entry.th32ProcessID != std::process::id() && self.names.iter().any(|target| target.eq_ignore_ascii_case(&name)) {
                    match unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, entry.th32ProcessID) } {
                        Ok(handle) => {
                            let handle = Handle(handle);
                            if self.owned(handle.0)? { result.push(identity(handle.0, entry.th32ProcessID)?); }
                        }
                        Err(error) if error.code() == windows::core::HRESULT::from_win32(ERROR_INVALID_PARAMETER.0) => {},
                        Err(error) => return Err(failure(error)),
                    }
                }
                next = unsafe { Process32NextW(snapshot.0, &mut entry) };
            }
            Ok(result)
        }
        fn request_exit(&mut self, process: &RunningProcess, force: bool) -> Result<(), EnforcerError> {
            let handle = match unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE, false, process.pid) } {
                Ok(handle) => Handle(handle),
                Err(error) if error.code() == windows::core::HRESULT::from_win32(ERROR_INVALID_PARAMETER.0) => return Ok(()),
                Err(error) => return Err(failure(error)),
            };
            if !self.owned(handle.0)? || identity(handle.0, process.pid)? != *process { return Ok(()); }
            if force {
                unsafe { TerminateProcess(handle.0, 1).map_err(failure)?; }
            } else {
                unsafe extern "system" fn close_window(window: HWND, data: LPARAM) -> BOOL {
                    let pid = data.0 as u32;
                    let mut window_pid = 0;
                    unsafe { GetWindowThreadProcessId(window, Some(&mut window_pid)); }
                    if window_pid == pid { unsafe { let _ = PostMessageW(Some(window), WM_CLOSE, Default::default(), Default::default()); } }
                    true.into()
                }
                unsafe { EnumWindows(Some(close_window), LPARAM(process.pid as isize)).map_err(failure)?; }
            }
            Ok(())
        }
    }
}

#[cfg(target_os = "windows")]
pub(super) use application::ApplicationBackend;

pub struct WindowsEnforcer;
impl Default for WindowsEnforcer {
    fn default() -> Self {
        Self::new()
    }
}

impl WindowsEnforcer {
    pub fn new() -> Self { Self }
    pub fn flush_dns(&self) -> Result<(), super::EnforcerError> {
        let output = std::process::Command::new("ipconfig").arg("/flushdns").output()
            .map_err(|e| super::EnforcerError::HostsFileError(e.to_string()))?;
        if !output.status.success() { return Err(super::EnforcerError::NotAuthorized); }
        Ok(())
    }
}

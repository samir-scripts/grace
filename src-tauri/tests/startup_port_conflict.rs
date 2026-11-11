#![cfg(target_os = "macos")]

use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::process::ExitStatusExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

struct TestDirectory(PathBuf);

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct AppProcess(Child);

impl Drop for AppProcess {
    fn drop(&mut self) {
        if matches!(self.0.try_wait(), Ok(None)) {
            let _ = self.0.kill();
        }
        let _ = self.0.wait();
    }
}

fn snapshot(path: &Path) -> Option<Vec<u8>> {
    match fs::read(path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => panic!("could not snapshot {}: {error}", path.display()),
    }
}

fn assert_failure_exit(status: ExitStatus) {
    assert_eq!(status.signal(), None, "startup terminated abnormally: {status}");
    assert_eq!(status.code(), Some(1), "startup did not report controlled failure");
}

#[test]
#[ignore = "requires an exclusive disposable macOS guest GUI and native-dialog acknowledgement"]
fn occupied_bridge_port_shows_error_then_exits_without_aborting() {
    assert_eq!(
        std::env::var("POMOTROID_DISPOSABLE_GUEST").as_deref(),
        Ok("1"),
        "run only in the disposable guest with POMOTROID_DISPOSABLE_GUEST=1"
    );
    let processes = Command::new("/bin/ps")
        .args(["-axo", "comm="])
        .output()
        .expect("could not inspect guest processes");
    assert!(processes.status.success());
    assert!(
        !String::from_utf8_lossy(&processes.stdout)
            .lines()
            .any(|line| Path::new(line.trim()).file_name().is_some_and(|name| name == "pomotroid")),
        "another Pomotroid process is running; use an exclusive guest"
    );

    let listener = TcpListener::bind(("127.0.0.1", 1421))
        .expect("port 1421 must be free before the test; do not terminate its existing owner");
    listener.set_nonblocking(true).unwrap();
    let app_data = PathBuf::from(std::env::var_os("HOME").expect("guest HOME missing"))
        .join("Library/Application Support/com.splode.pomotroid");
    let names = [
        "focus_browser_config.json",
        "pomotroid.db",
        "pomotroid.db-wal",
        "pomotroid.db-shm",
    ];
    let before: Vec<_> = names.iter().map(|name| snapshot(&app_data.join(name))).collect();
    let directory = TestDirectory(std::env::temp_dir().join(format!(
        "pomotroid-startup-conflict-{}",
        uuid::Uuid::new_v4()
    )));
    fs::create_dir(&directory.0).unwrap();
    let stdout = File::create(directory.0.join("stdout.log")).unwrap();
    let stderr = File::create(directory.0.join("stderr.log")).unwrap();
    let mut app = AppProcess(
        Command::new(env!("CARGO_BIN_EXE_pomotroid"))
            .stdin(Stdio::null())
            .stdout(stdout)
            .stderr(stderr)
            .spawn()
            .expect("could not launch the native app"),
    );

    let observation_deadline = Instant::now() + Duration::from_secs(3);
    let mut exited = None;
    while Instant::now() < observation_deadline {
        if let Some(status) = app.0.try_wait().unwrap() {
            assert_failure_exit(status);
            exited = Some(status);
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    if exited.is_none() {
        eprintln!("ACKNOWLEDGE_NATIVE_DIALOG: inspect the guest error dialog, then click OK.");
        let deadline = Instant::now() + Duration::from_secs(120);
        loop {
            if let Some(status) = app.0.try_wait().unwrap() {
                assert_failure_exit(status);
                break;
            }
            assert!(Instant::now() < deadline, "native dialog was not acknowledged within 120 seconds");
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    for (name, original) in names.iter().zip(before.iter()) {
        assert!(
            snapshot(&app_data.join(name)).as_ref() == original.as_ref(),
            "startup failure changed persisted file {name}"
        );
    }
    let mut client = TcpStream::connect(("127.0.0.1", 1421)).unwrap();
    client.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    client.set_write_timeout(Some(Duration::from_secs(5))).unwrap();
    client.write_all(b"fixture owner retained").unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let (mut accepted, _) = loop {
        match listener.accept() {
            Ok(connection) => break connection,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                assert!(Instant::now() < deadline, "original listener became unusable");
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(error) => panic!("original listener failed: {error}"),
        }
    };
    accepted.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    accepted.set_write_timeout(Some(Duration::from_secs(5))).unwrap();
    let mut received = [0; 22];
    accepted.read_exact(&mut received).unwrap();
    assert_eq!(&received, b"fixture owner retained");
    accepted.write_all(b"ok").unwrap();
    let mut response = [0; 2];
    client.read_exact(&mut response).unwrap();
    assert_eq!(&response, b"ok");
}

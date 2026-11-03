fn main() {
    #[cfg(windows)]
    {
        // On Windows, stdin and stdout must be set to binary mode for native messaging
        unsafe {
            extern "C" {
                fn _setmode(fd: i32, mode: i32) -> i32;
            }
            const _O_BINARY: i32 = 0x8000;
            _setmode(0, _O_BINARY);
            _setmode(1, _O_BINARY);
        }
    }

    if let Err(err) = pomotroid_lib::focus::native_messaging::run_native_host_stdio() {
        eprintln!("[pomotroid-native-host] error: {err}");
        std::process::exit(1);
    }
}

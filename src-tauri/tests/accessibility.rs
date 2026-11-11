#[test]
fn test_accessibility_commands_callable() {
    let _: bool = pomotroid_lib::commands::accessibility_trusted();
    let _: bool = pomotroid_lib::commands::accessibility_request();
}

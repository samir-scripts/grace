use std::io::{self, BufRead, Write};
use std::sync::Arc;
use pomotroid_lib::focus::browser::BrowserBridge;
use pomotroid_lib::focus::enforcer::NativeEnforcer;

#[tokio::main]
async fn main() {
    let port: u16 = std::env::args().nth(1).unwrap().parse().unwrap();
    let bridge = Arc::new(BrowserBridge::new_in_memory("fixture-token".into(), port).await.unwrap());
    println!("ready");
    for line in io::stdin().lock().lines() {
        let line = line.unwrap();
        match line.as_str() {
            "status" => println!("{}", bridge.get_setup_info().profiles.iter().any(|p| p.is_connected)),
            "apply" => {
                let b = bridge.clone();
                let result = tokio::task::spawn_blocking(move || b.apply_blocking(&[], &["127.0.0.1".into()])).await.unwrap();
                println!("{}", if result.is_ok() { "applied" } else { "apply-error" });
            }
            "release" => {
                let b = bridge.clone();
                let result = tokio::task::spawn_blocking(move || b.release_blocking()).await.unwrap();
                println!("{}", if result.is_ok() { "released" } else { "release-error" });
            }
            "quit" => break,
            _ => println!("unknown"),
        }
        io::stdout().flush().unwrap();
    }
    bridge.shutdown().await;
}

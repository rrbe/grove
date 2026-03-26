use std::process::Command;

fn main() {
    // Embed the short git commit hash at compile time
    let hash = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_default();
    println!("cargo:rustc-env=GROVE_COMMIT_HASH={}", hash.trim());

    tauri_build::build()
}

fn main() {
    // Cargo must rebuild PE resources when artwork changes, not only Rust sources.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/32x32.png");
    println!("cargo:rerun-if-changed=icons/tray.png");
    tauri_build::build()
}

fn main() {
    for icon in [
        "../installer/icons/icon.ico",
        "../installer/icons/icon.png",
        "../installer/icons/32x32.png",
        "../installer/icons/128x128.png",
        "../installer/icons/128x128@2x.png",
        "../installer/icons/tray.png",
    ] {
        println!("cargo:rerun-if-changed={icon}");
    }
    tauri_build::build();
}

use std::env;
use std::fs;
use std::path::Path;

fn main() {
    println!("cargo:rerun-if-changed=../../dist/index.html");
    println!("cargo:rerun-if-changed=../dist/index.html");
    println!("cargo:rerun-if-changed=dist/index.html");

    let out_dir = env::var("OUT_DIR").expect("OUT_DIR not set by cargo");
    let dest_path = Path::new(&out_dir).join("index.html");

    // Search candidate locations for the bundled frontend HTML
    let candidates = [
        "../../dist/index.html",
        "../dist/index.html",
        "dist/index.html",
    ];

    for candidate in candidates {
        if let Ok(content) = fs::read(candidate) {
            fs::write(&dest_path, content).expect("Failed to write index.html to OUT_DIR");
            return;
        }
    }

    panic!(
        "\n\n❌ [tfview] Frontend bundle not found.\n\
         Please run 'just build' (or 'node scripts/build-single-html.js') in the project root to generate dist/index.html first.\n\n"
    );
}

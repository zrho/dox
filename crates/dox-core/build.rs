use std::{env, fs, path::Path};

fn collect(root: &Path, directory: &Path, output: &mut String) {
    let mut entries: Vec<_> = fs::read_dir(directory)
        .expect("Read reader assets")
        .map(|entry| entry.expect("Read reader asset").path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            collect(root, &path, output);
        } else if path.is_file() {
            let name = path
                .strip_prefix(root)
                .unwrap()
                .to_str()
                .unwrap()
                .replace('\\', "/");
            output.push_str(&format!(
                "({name:?}, include_bytes!({:?})),\n",
                path.canonicalize().unwrap()
            ));
        }
    }
}
fn main() {
    let root = Path::new("../../web-reader/dist");
    println!("cargo:rerun-if-changed={}", root.display());
    assert!(
        root.join("index.html").is_file(),
        "Missing web reader bundle. Run `cd web-reader && npm ci && npm run build` first."
    );
    let mut output = String::from("const WEB_ASSETS: &[(&str, &[u8])] = &[\n");
    collect(root, root, &mut output);
    output.push_str("];\n");
    fs::write(
        Path::new(&env::var_os("OUT_DIR").unwrap()).join("web_assets.rs"),
        output,
    )
    .unwrap();
}
